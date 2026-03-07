import * as oauth from 'oauth4webapi';
import { OpenApiMcpError } from '../errors.js';

export interface DeviceAuthParams {
  cacheKey: string;
  deviceAuthorizationEndpoint: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
}

export interface DeviceAuthResponse {
  status: 'authorization_required';
  method: 'device_code';
  message: string;
  verificationUri: string;
  verificationUriComplete?: string;
  userCode: string;
  expiresInSeconds: number;
  instruction: string;
}

interface PendingDeviceAuth {
  params: DeviceAuthParams;
  deviceCode: string;
  expiresAtMs: number;
  interval: number;
  as: oauth.AuthorizationServer;
  client: oauth.Client;
  clientAuth: oauth.ClientAuth;
}

export class DeviceCodeFlowManager {
  private readonly pending = new Map<string, PendingDeviceAuth>();

  async startDeviceAuth(params: DeviceAuthParams): Promise<DeviceAuthResponse> {
    const as: oauth.AuthorizationServer = {
      issuer: new URL(params.tokenUrl).origin,
      token_endpoint: params.tokenUrl,
      device_authorization_endpoint: params.deviceAuthorizationEndpoint,
    };
    const client: oauth.Client = { client_id: params.clientId };
    const clientAuth =
      params.tokenEndpointAuthMethod === 'client_secret_post'
        ? oauth.ClientSecretPost(params.clientSecret)
        : oauth.ClientSecretBasic(params.clientSecret);

    const parameters = new URLSearchParams();
    if (params.scopes.length > 0) {
      parameters.set('scope', params.scopes.join(' '));
    }

    try {
      const response = await oauth.deviceAuthorizationRequest(
        as,
        client,
        clientAuth,
        parameters,
      );
      const result = await oauth.processDeviceAuthorizationResponse(
        as,
        client,
        response,
      );

      this.pending.set(params.cacheKey, {
        params,
        deviceCode: result.device_code,
        expiresAtMs: Date.now() + (result.expires_in ?? 600) * 1000,
        interval: result.interval ?? 5,
        as,
        client,
        clientAuth,
      });

      const authResponse: DeviceAuthResponse = {
        status: 'authorization_required',
        method: 'device_code',
        message:
          'User authorization required. Ask the user to visit the URL and enter the code.',
        verificationUri: result.verification_uri,
        userCode: result.user_code,
        expiresInSeconds: result.expires_in ?? 600,
        instruction: 'After the user confirms, call this endpoint again.',
      };
      if (result.verification_uri_complete) {
        authResponse.verificationUriComplete = result.verification_uri_complete;
      }
      return authResponse;
    } catch (error) {
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        'Device authorization request failed',
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async pollDeviceAuth(
    cacheKey: string,
  ): Promise<
    | { status: 'complete'; token: { accessToken: string; expiresIn?: number } }
    | { status: 'pending' }
  > {
    const entry = this.pending.get(cacheKey);
    if (!entry) {
      return { status: 'pending' };
    }

    if (Date.now() > entry.expiresAtMs) {
      this.pending.delete(cacheKey);
      throw new OpenApiMcpError('AUTH_ERROR', 'Device authorization expired');
    }

    try {
      const response = await oauth.deviceCodeGrantRequest(
        entry.as,
        entry.client,
        entry.clientAuth,
        entry.deviceCode,
      );
      const result = await oauth.processDeviceCodeResponse(
        entry.as,
        entry.client,
        response,
      );
      this.pending.delete(cacheKey);
      return {
        status: 'complete',
        token: {
          accessToken: result.access_token,
          expiresIn: result.expires_in,
        },
      };
    } catch (error) {
      if (
        error instanceof oauth.ResponseBodyError &&
        error.cause?.error === 'authorization_pending'
      ) {
        return { status: 'pending' };
      }
      if (
        error instanceof oauth.ResponseBodyError &&
        error.cause?.error === 'slow_down'
      ) {
        entry.interval = Math.min(entry.interval + 5, 30);
        return { status: 'pending' };
      }
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        'Device code grant request failed',
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  hasPending(cacheKey: string): boolean {
    return this.pending.has(cacheKey);
  }
}
