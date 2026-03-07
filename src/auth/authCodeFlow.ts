import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import * as oauth from 'oauth4webapi';
import { OpenApiMcpError } from '../errors.js';

export interface AuthCodeFlowParams {
  cacheKey: string;
  authorizationEndpoint: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
  pkce: boolean;
  redirectPort?: number;
}

export interface AuthCodeStartResponse {
  status: 'authorization_required';
  method: 'authorization_code';
  message: string;
  authorizationUrl: string;
  instruction: string;
}

interface PendingAuthCode {
  params: AuthCodeFlowParams;
  server: Server;
  port: number;
  state: string;
  codeVerifier?: string;
  as: oauth.AuthorizationServer;
  client: oauth.Client;
  clientAuth: oauth.ClientAuth;
  callbackReceived?: { code: string; state: string };
  callbackError?: string;
  expiresAtMs: number;
}

const AUTH_CODE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export class AuthCodeFlowManager {
  private readonly pending = new Map<string, PendingAuthCode>();

  async startAuthCodeFlow(
    params: AuthCodeFlowParams,
  ): Promise<AuthCodeStartResponse> {
    const as: oauth.AuthorizationServer = {
      issuer: new URL(params.tokenUrl).origin,
      token_endpoint: params.tokenUrl,
      authorization_endpoint: params.authorizationEndpoint,
    };
    const client: oauth.Client = { client_id: params.clientId };
    const clientAuth =
      params.tokenEndpointAuthMethod === 'client_secret_post'
        ? oauth.ClientSecretPost(params.clientSecret)
        : oauth.ClientSecretBasic(params.clientSecret);

    const state = randomBytes(16).toString('hex');
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (params.pkce) {
      codeVerifier = oauth.generateRandomCodeVerifier();
      codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    }

    const { server, port } = await startCallbackServer(params.redirectPort);
    const redirectUri = `http://localhost:${port}/callback`;

    const entry: PendingAuthCode = {
      params,
      server,
      port,
      state,
      codeVerifier,
      as,
      client,
      clientAuth,
      expiresAtMs: Date.now() + AUTH_CODE_TIMEOUT_MS,
    };

    // Set up callback handler
    server.on('request', (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        entry.callbackError =
          error + (url.searchParams.get('error_description') ?? '');
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(
          '<html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>',
        );
        return;
      }

      if (code && returnedState) {
        entry.callbackReceived = { code, state: returnedState };
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(
          '<html><body><h1>Authorization successful</h1><p>You can close this window.</p></body></html>',
        );
      } else {
        res.writeHead(400);
        res.end('Missing code or state');
      }
    });

    this.pending.set(params.cacheKey, entry);

    // Build authorization URL
    const authUrl = new URL(params.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', params.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    if (params.scopes.length > 0) {
      authUrl.searchParams.set('scope', params.scopes.join(' '));
    }
    if (codeChallenge) {
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
    }

    // Set timeout to clean up server
    setTimeout(() => {
      const e = this.pending.get(params.cacheKey);
      if (e) {
        e.server.close();
        this.pending.delete(params.cacheKey);
      }
    }, AUTH_CODE_TIMEOUT_MS);

    return {
      status: 'authorization_required',
      method: 'authorization_code',
      message:
        'User authorization required. Ask the user to open the URL in their browser.',
      authorizationUrl: authUrl.toString(),
      instruction:
        'After the user authorizes in the browser, call this endpoint again.',
    };
  }

  async pollAuthCodeFlow(
    cacheKey: string,
  ): Promise<{ status: 'complete'; token: string } | { status: 'pending' }> {
    const entry = this.pending.get(cacheKey);
    if (!entry) {
      return { status: 'pending' };
    }

    if (Date.now() > entry.expiresAtMs) {
      entry.server.close();
      this.pending.delete(cacheKey);
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        'Authorization code flow expired',
      );
    }

    if (entry.callbackError) {
      entry.server.close();
      this.pending.delete(cacheKey);
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        `Authorization failed: ${entry.callbackError}`,
      );
    }

    if (!entry.callbackReceived) {
      return { status: 'pending' };
    }

    if (entry.callbackReceived.state !== entry.state) {
      entry.server.close();
      this.pending.delete(cacheKey);
      throw new OpenApiMcpError('AUTH_ERROR', 'OAuth2 state mismatch');
    }

    const redirectUri = `http://localhost:${entry.port}/callback`;

    try {
      const callbackParams = new URLSearchParams({
        code: entry.callbackReceived.code,
        state: entry.callbackReceived.state,
      });
      const response = await oauth.authorizationCodeGrantRequest(
        entry.as,
        entry.client,
        entry.clientAuth,
        callbackParams,
        redirectUri,
        entry.codeVerifier ?? oauth.nopkce,
      );
      const result = await oauth.processAuthorizationCodeResponse(
        entry.as,
        entry.client,
        response,
      );
      entry.server.close();
      this.pending.delete(cacheKey);
      return { status: 'complete', token: result.access_token };
    } catch (error) {
      entry.server.close();
      this.pending.delete(cacheKey);
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        'Authorization code token exchange failed',
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  hasPending(cacheKey: string): boolean {
    return this.pending.has(cacheKey);
  }

  cleanup(): void {
    for (const entry of this.pending.values()) {
      entry.server.close();
    }
    this.pending.clear();
  }
}

function startCallbackServer(
  preferredPort?: number,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(preferredPort ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to get server port'));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}
