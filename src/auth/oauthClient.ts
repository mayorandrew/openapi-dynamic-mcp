import * as oauth from 'oauth4webapi';
import { OpenApiMcpError } from '../errors.js';
import {
  DeviceCodeFlowManager,
  type DeviceAuthParams,
  type DeviceAuthResponse,
} from './deviceCodeFlow.js';
import {
  AuthCodeFlowManager,
  type AuthCodeFlowParams,
  type AuthCodeStartResponse,
} from './authCodeFlow.js';

export interface OAuthTokenRequest {
  cacheKey: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
}

export interface OAuthPasswordGrantRequest extends OAuthTokenRequest {
  username: string;
  password: string;
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

const TOKEN_EXPIRY_SAFETY_MS = 60_000;

export type InteractiveAuthResult =
  | DeviceAuthResponse
  | AuthCodeStartResponse
  | {
      status: 'authorization_pending';
      method: 'device_code' | 'authorization_code';
      message: string;
      instruction: string;
    };

export class OAuthClient {
  private readonly cache = new Map<string, TokenCacheEntry>();
  readonly deviceCodeFlow = new DeviceCodeFlowManager();
  readonly authCodeFlow = new AuthCodeFlowManager();

  async getClientCredentialsToken(request: OAuthTokenRequest): Promise<string> {
    const cached = this.cache.get(request.cacheKey);
    if (cached && cached.expiresAtMs - Date.now() > TOKEN_EXPIRY_SAFETY_MS) {
      return cached.accessToken;
    }

    const as: oauth.AuthorizationServer = {
      issuer: new URL(request.tokenUrl).origin,
      token_endpoint: request.tokenUrl,
    };
    const client: oauth.Client = {
      client_id: request.clientId,
    };
    const clientAuth =
      request.tokenEndpointAuthMethod === 'client_secret_post'
        ? oauth.ClientSecretPost(request.clientSecret)
        : oauth.ClientSecretBasic(request.clientSecret);
    const parameters = new URLSearchParams();
    if (request.scopes.length > 0) {
      parameters.set('scope', request.scopes.join(' '));
    }

    try {
      const tokenResponse = await oauth.clientCredentialsGrantRequest(
        as,
        client,
        clientAuth,
        parameters,
      );
      const tokenResult = await oauth.processClientCredentialsResponse(
        as,
        client,
        tokenResponse,
      );
      this.cache.set(request.cacheKey, {
        accessToken: tokenResult.access_token,
        expiresAtMs:
          Date.now() + Math.max(tokenResult.expires_in ?? 3600, 1) * 1000,
      });

      return tokenResult.access_token;
    } catch (error) {
      if (error instanceof oauth.ResponseBodyError) {
        throw new OpenApiMcpError('AUTH_ERROR', 'OAuth2 token request failed', {
          tokenUrl: request.tokenUrl,
          oauthError: error.cause,
        });
      }

      if (error instanceof oauth.OperationProcessingError) {
        throw new OpenApiMcpError('AUTH_ERROR', 'OAuth2 operation failed', {
          tokenUrl: request.tokenUrl,
          code: error.code,
          cause: error.message,
        });
      }

      throw new OpenApiMcpError('AUTH_ERROR', 'OAuth2 token request failed', {
        tokenUrl: request.tokenUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getPasswordGrantToken(
    request: OAuthPasswordGrantRequest,
  ): Promise<string> {
    const cached = this.cache.get(request.cacheKey);
    if (cached && cached.expiresAtMs - Date.now() > TOKEN_EXPIRY_SAFETY_MS) {
      return cached.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'password',
      username: request.username,
      password: request.password,
    });
    if (request.scopes.length > 0) {
      body.set('scope', request.scopes.join(' '));
    }

    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };

    if (request.tokenEndpointAuthMethod === 'client_secret_basic') {
      headers.authorization = `Basic ${Buffer.from(`${request.clientId}:${request.clientSecret}`).toString('base64')}`;
    } else {
      body.set('client_id', request.clientId);
      body.set('client_secret', request.clientSecret);
    }

    let response: Response;
    try {
      response = await fetch(request.tokenUrl, {
        method: 'POST',
        headers,
        body,
      });
    } catch (error) {
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        'OAuth2 password grant request failed',
        {
          tokenUrl: request.tokenUrl,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        'OAuth2 password grant request failed',
        {
          tokenUrl: request.tokenUrl,
          status: response.status,
          oauthError: errorBody,
        },
      );
    }

    const result = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };

    this.cache.set(request.cacheKey, {
      accessToken: result.access_token,
      expiresAtMs: Date.now() + Math.max(result.expires_in ?? 3600, 1) * 1000,
    });

    return result.access_token;
  }

  getCachedToken(cacheKey: string): string | undefined {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs - Date.now() > TOKEN_EXPIRY_SAFETY_MS) {
      return cached.accessToken;
    }
    return undefined;
  }

  cacheToken(cacheKey: string, accessToken: string, expiresIn?: number): void {
    this.cache.set(cacheKey, {
      accessToken,
      expiresAtMs: Date.now() + Math.max(expiresIn ?? 3600, 1) * 1000,
    });
  }

  async startOrPollDeviceCode(
    params: DeviceAuthParams,
  ): Promise<{ token: string } | InteractiveAuthResult> {
    const cached = this.getCachedToken(params.cacheKey);
    if (cached) return { token: cached };

    if (this.deviceCodeFlow.hasPending(params.cacheKey)) {
      const pollResult = await this.deviceCodeFlow.pollDeviceAuth(
        params.cacheKey,
      );
      if (pollResult.status === 'complete') {
        this.cacheToken(params.cacheKey, pollResult.token);
        return { token: pollResult.token };
      }
      return {
        status: 'authorization_pending',
        method: 'device_code',
        message:
          'Authorization is still pending. The user has not yet approved.',
        instruction:
          'Ask the user if they have completed authorization, then call this endpoint again.',
      };
    }

    const response = await this.deviceCodeFlow.startDeviceAuth(params);
    console.error(
      `[openapi-mcp] Authorization required. Visit: ${response.verificationUriComplete ?? response.verificationUri} Code: ${response.userCode}`,
    );
    return response;
  }

  async startOrPollAuthCode(
    params: AuthCodeFlowParams,
  ): Promise<{ token: string } | InteractiveAuthResult> {
    const cached = this.getCachedToken(params.cacheKey);
    if (cached) return { token: cached };

    if (this.authCodeFlow.hasPending(params.cacheKey)) {
      const pollResult = await this.authCodeFlow.pollAuthCodeFlow(
        params.cacheKey,
      );
      if (pollResult.status === 'complete') {
        this.cacheToken(params.cacheKey, pollResult.token);
        return { token: pollResult.token };
      }
      return {
        status: 'authorization_pending',
        method: 'authorization_code',
        message:
          'Authorization is still pending. The user has not yet completed the browser flow.',
        instruction:
          'Ask the user if they have completed authorization, then call this endpoint again.',
      };
    }

    const response = await this.authCodeFlow.startAuthCodeFlow(params);
    console.error(
      `[openapi-mcp] Authorization required. Open: ${response.authorizationUrl}`,
    );
    return response;
  }
}
