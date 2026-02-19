import * as oauth from 'oauth4webapi';
import { OpenApiMcpError } from '../errors.js';

export interface OAuthTokenRequest {
  cacheKey: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

const TOKEN_EXPIRY_SAFETY_MS = 60_000;

export class OAuthClient {
  private readonly cache = new Map<string, TokenCacheEntry>();

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
}
