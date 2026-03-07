import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nock from 'nock';
import type { OpenAPIV3 } from 'openapi-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

const oauth4webapiMocks = vi.hoisted(() => ({
  authorizationCodeGrantRequest: undefined as
    | undefined
    | ((...args: unknown[]) => Promise<Response>),
  processAuthorizationCodeResponse: undefined as
    | undefined
    | ((
        ...args: unknown[]
      ) => Promise<{ access_token: string; expires_in?: number }>),
}));

vi.mock('oauth4webapi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('oauth4webapi')>();
  return {
    ...actual,
    authorizationCodeGrantRequest: (...args: unknown[]) =>
      oauth4webapiMocks.authorizationCodeGrantRequest
        ? oauth4webapiMocks.authorizationCodeGrantRequest(...args)
        : actual.authorizationCodeGrantRequest(
            ...(args as Parameters<
              typeof actual.authorizationCodeGrantRequest
            >),
          ),
    processAuthorizationCodeResponse: (...args: unknown[]) =>
      oauth4webapiMocks.processAuthorizationCodeResponse
        ? oauth4webapiMocks.processAuthorizationCodeResponse(...args)
        : actual.processAuthorizationCodeResponse(
            ...(args as Parameters<
              typeof actual.processAuthorizationCodeResponse
            >),
          ),
  };
});

import { AuthCodeFlowManager } from '../src/auth/authCodeFlow.js';
import { AuthStore } from '../src/auth/authStore.js';
import { DeviceCodeFlowManager } from '../src/auth/deviceCodeFlow.js';
import {
  authenticateSelectedScheme,
  resolveSchemeForRequest,
} from '../src/auth/schemeAuth.js';
import { OAuthClient } from '../src/auth/oauthClient.js';
import { loadApiRegistry } from '../src/openapi/loadSpec.js';
import type {
  EndpointDefinition,
  LoadedApi,
  RootConfig,
} from '../src/types.js';

const fixturesDir = path.resolve('test/fixtures');

afterEach(() => {
  oauth4webapiMocks.authorizationCodeGrantRequest = undefined;
  oauth4webapiMocks.processAuthorizationCodeResponse = undefined;
  nock.abortPendingRequests();
  nock.cleanAll();
});

describe('AuthCodeFlowManager', () => {
  it('completes the callback flow and exchanges the token', async () => {
    const manager = new AuthCodeFlowManager();
    oauth4webapiMocks.authorizationCodeGrantRequest = async () =>
      new Response('{}', { status: 200 });
    oauth4webapiMocks.processAuthorizationCodeResponse = async () => ({
      access_token: 'auth-code-token',
      expires_in: 3600,
    });

    const started = await manager.startAuthCodeFlow({
      cacheKey: 'auth-code-success',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/oauth/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: ['read:pets'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      pkce: true,
    });

    const state = new URL(started.authorizationUrl).searchParams.get('state');
    const entry = getAuthCodeEntry(manager, 'auth-code-success');
    entry.callbackReceived = {
      code: 'code-123',
      state: state as string,
    };
    await expect(
      manager.pollAuthCodeFlow('auth-code-success'),
    ).resolves.toEqual({
      status: 'complete',
      token: {
        accessToken: 'auth-code-token',
        expiresIn: 3600,
      },
    });
    expect(manager.hasPending('auth-code-success')).toBe(false);
  });

  it('reports callback errors from the browser redirect', async () => {
    const manager = new AuthCodeFlowManager();
    await manager.startAuthCodeFlow({
      cacheKey: 'auth-code-error',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/oauth/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: [],
      tokenEndpointAuthMethod: 'client_secret_basic',
      pkce: false,
    });

    const entry = getAuthCodeEntry(manager, 'auth-code-error');
    entry.callbackError = 'access_denieddenied';

    await expect(
      manager.pollAuthCodeFlow('auth-code-error'),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: expect.stringContaining(
        'Authorization failed: access_denieddenied',
      ),
    });
  });

  it('rejects state mismatches', async () => {
    const manager = new AuthCodeFlowManager();
    await manager.startAuthCodeFlow({
      cacheKey: 'auth-code-state',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/oauth/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: [],
      tokenEndpointAuthMethod: 'client_secret_basic',
      pkce: false,
    });

    const entry = getAuthCodeEntry(manager, 'auth-code-state');
    entry.callbackReceived = { code: 'code-123', state: 'wrong-state' };

    await expect(
      manager.pollAuthCodeFlow('auth-code-state'),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: 'OAuth2 state mismatch',
    });
  });

  it('rejects expired pending flows', async () => {
    const manager = new AuthCodeFlowManager();
    await manager.startAuthCodeFlow({
      cacheKey: 'auth-code-expired',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/oauth/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: [],
      tokenEndpointAuthMethod: 'client_secret_basic',
      pkce: false,
    });

    const entry = getAuthCodeEntry(manager, 'auth-code-expired');
    entry.expiresAtMs = Date.now() - 1;

    await expect(
      manager.pollAuthCodeFlow('auth-code-expired'),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: 'Authorization code flow expired',
    });
  });

  it('wraps token exchange failures', async () => {
    const manager = new AuthCodeFlowManager();
    const started = await manager.startAuthCodeFlow({
      cacheKey: 'auth-code-token-fail',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/oauth/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: [],
      tokenEndpointAuthMethod: 'client_secret_basic',
      pkce: false,
    });

    const state = new URL(started.authorizationUrl).searchParams.get('state');
    const entry = getAuthCodeEntry(manager, 'auth-code-token-fail');
    entry.callbackReceived = {
      code: 'code-123',
      state: state as string,
    };

    nock('https://auth.example.com')
      .post('/oauth/token')
      .reply(400, { error: 'invalid_grant' });

    await expect(
      manager.pollAuthCodeFlow('auth-code-token-fail'),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: 'Authorization code token exchange failed',
    });
    expect(manager.hasPending('auth-code-token-fail')).toBe(false);
  });

  it('cleans up pending servers', async () => {
    const manager = new AuthCodeFlowManager();
    await manager.startAuthCodeFlow({
      cacheKey: 'auth-code-cleanup',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/oauth/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: [],
      tokenEndpointAuthMethod: 'client_secret_basic',
      pkce: false,
    });

    expect(manager.hasPending('auth-code-cleanup')).toBe(true);
    manager.cleanup();
    expect(manager.hasPending('auth-code-cleanup')).toBe(false);
  });
});

describe('DeviceCodeFlowManager', () => {
  it('starts device auth and returns verification details', async () => {
    const manager = new DeviceCodeFlowManager();

    nock('https://auth.example.com').post('/device').reply(200, {
      device_code: 'device-1',
      user_code: 'CODE-1234',
      verification_uri: 'https://auth.example.com/device',
      verification_uri_complete:
        'https://auth.example.com/device?user_code=CODE-1234',
      expires_in: 600,
      interval: 5,
    });

    const started = await manager.startDeviceAuth({
      cacheKey: 'device-success',
      deviceAuthorizationEndpoint: 'https://auth.example.com/device',
      tokenUrl: 'https://auth.example.com/oauth/token',
      clientId: 'client',
      clientSecret: 'secret',
      scopes: ['read:pets'],
      tokenEndpointAuthMethod: 'client_secret_basic',
    });

    expect(started).toMatchObject({
      status: 'authorization_required',
      method: 'device_code',
      userCode: 'CODE-1234',
      verificationUri: 'https://auth.example.com/device',
      verificationUriComplete:
        'https://auth.example.com/device?user_code=CODE-1234',
    });
    expect(manager.hasPending('device-success')).toBe(true);
  });

  it('returns pending for authorization_pending responses', async () => {
    const manager = await seedDeviceFlow('device-pending');

    nock('https://auth.example.com')
      .post('/oauth/token')
      .reply(400, { error: 'authorization_pending' });

    await expect(manager.pollDeviceAuth('device-pending')).resolves.toEqual({
      status: 'pending',
    });
    expect(manager.hasPending('device-pending')).toBe(true);
  });

  it('handles slow_down responses without dropping the pending flow', async () => {
    const manager = await seedDeviceFlow('device-slow-down');

    nock('https://auth.example.com')
      .post('/oauth/token')
      .reply(400, { error: 'slow_down' });

    await expect(manager.pollDeviceAuth('device-slow-down')).resolves.toEqual({
      status: 'pending',
    });

    const entry = getDeviceEntry(manager, 'device-slow-down');
    expect(entry.interval).toBe(10);
  });

  it('rejects expired device flows', async () => {
    const manager = await seedDeviceFlow('device-expired');
    const entry = getDeviceEntry(manager, 'device-expired');
    entry.expiresAtMs = Date.now() - 1;

    await expect(
      manager.pollDeviceAuth('device-expired'),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: 'Device authorization expired',
    });
  });

  it('completes successful device token polling', async () => {
    const manager = await seedDeviceFlow('device-complete');

    nock('https://auth.example.com').post('/oauth/token').reply(200, {
      access_token: 'device-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    await expect(manager.pollDeviceAuth('device-complete')).resolves.toEqual({
      status: 'complete',
      token: {
        accessToken: 'device-token',
        expiresIn: 3600,
      },
    });
    expect(manager.hasPending('device-complete')).toBe(false);
  });

  it('wraps device authorization request failures', async () => {
    const manager = new DeviceCodeFlowManager();

    nock('https://auth.example.com')
      .post('/device')
      .replyWithError('start failed');

    await expect(
      manager.startDeviceAuth({
        cacheKey: 'device-start-fail',
        deviceAuthorizationEndpoint: 'https://auth.example.com/device',
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: 'client',
        clientSecret: 'secret',
        scopes: [],
        tokenEndpointAuthMethod: 'client_secret_basic',
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: 'Device authorization request failed',
    });
  });

  it('wraps non-pending poll failures', async () => {
    const manager = await seedDeviceFlow('device-poll-fail');

    nock('https://auth.example.com')
      .post('/oauth/token')
      .replyWithError('grant failed');

    await expect(
      manager.pollDeviceAuth('device-poll-fail'),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message: 'Device code grant request failed',
    });
  });
});

describe('schemeAuth direct coverage', () => {
  it('uses stored oauth2 tokens for request resolution', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'openapi-mcp-store-'));
    const store = new AuthStore(path.join(tempDir, 'auth.json'));

    try {
      const api = await loadFixtureApi('pet-api');
      await store.setOAuth2Token({
        apiName: 'pet-api',
        schemeName: 'OAuthCC',
        accessToken: 'stored-oauth-token',
      });

      await expect(
        resolveSchemeForRequest({
          api,
          schemeName: 'OAuthCC',
          oauthClient: new OAuthClient(),
          authStore: store,
          env: {},
        }),
      ).resolves.toMatchObject({
        status: 'resolved',
        authUsed: 'OAuthCC',
        resolved: {
          type: 'oauth2',
          token: 'stored-oauth-token',
        },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns api key and bearer tokens from authenticateSelectedScheme', async () => {
    const api = await loadFixtureApi('pet-api');

    await expect(
      authenticateSelectedScheme({
        api,
        schemeName: 'ApiKeyAuth',
        token: 'api-token',
        oauthClient: new OAuthClient(),
        env: {},
      }),
    ).resolves.toMatchObject({
      kind: 'apiKey',
      token: 'api-token',
    });

    await expect(
      authenticateSelectedScheme({
        api,
        schemeName: 'BearerAuth',
        token: 'bearer-token',
        oauthClient: new OAuthClient(),
        env: {},
      }),
    ).resolves.toMatchObject({
      kind: 'http-bearer',
      token: 'bearer-token',
    });
  });

  it('rejects basic auth in the auth command', async () => {
    const api = await loadFixtureApi('pet-api');

    await expect(
      authenticateSelectedScheme({
        api,
        schemeName: 'BasicAuth',
        token: 'ignored',
        oauthClient: new OAuthClient(),
        env: {},
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      message:
        "HTTP basic scheme 'BasicAuth' is not supported by the auth command",
    });
  });

  it('reports missing device authorization endpoints', async () => {
    const api = await loadFixtureApi('pet-api');

    await expect(
      resolveSchemeForRequest({
        api,
        schemeName: 'OAuthAuthCode',
        oauthClient: new OAuthClient(),
        env: {
          PET_API_OAUTHAUTHCODE_CLIENT_ID: 'client',
          PET_API_OAUTHAUTHCODE_CLIENT_SECRET: 'secret',
          PET_API_OAUTHAUTHCODE_AUTH_METHOD: 'device_code',
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failedReason:
        "Device authorization endpoint not configured for 'OAuthAuthCode'",
      missingEnv: ['PET_API_OAUTHAUTHCODE_DEVICE_AUTHORIZATION_ENDPOINT'],
    });
  });

  it('reports missing authorization endpoints for auth code schemes', async () => {
    const api = buildInlineApi('broken-auth-code', {
      BrokenAuth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: '',
            tokenUrl: 'https://auth.example.com/token',
            scopes: {},
          },
        },
      },
    });

    await expect(
      resolveSchemeForRequest({
        api,
        schemeName: 'BrokenAuth',
        oauthClient: new OAuthClient(),
        env: {
          BROKEN_AUTH_CODE_BROKENAUTH_CLIENT_ID: 'client',
          BROKEN_AUTH_CODE_BROKENAUTH_CLIENT_SECRET: 'secret',
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failedReason: "No authorization endpoint for scheme 'BrokenAuth'",
    });
  });

  it('reports oauth2 schemes with no supported flows once a token url exists', async () => {
    const api = buildInlineApi('no-flow-api', {
      EmptyOauth: {
        type: 'oauth2',
        flows: {},
      },
    });

    await expect(
      resolveSchemeForRequest({
        api,
        schemeName: 'EmptyOauth',
        oauthClient: new OAuthClient(),
        env: {
          NO_FLOW_API_EMPTYOAUTH_CLIENT_ID: 'client',
          NO_FLOW_API_EMPTYOAUTH_CLIENT_SECRET: 'secret',
          NO_FLOW_API_EMPTYOAUTH_TOKEN_URL: 'https://auth.example.com/token',
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      failedReason: "Scheme 'EmptyOauth' has no supported OAuth2 flow",
      missingEnv: ['NO_FLOW_API_EMPTYOAUTH_ACCESS_TOKEN'],
    });
  });
});

function getAuthCodeEntry(
  manager: AuthCodeFlowManager,
  cacheKey: string,
): {
  callbackError?: string;
  callbackReceived?: { code: string; state: string };
  expiresAtMs: number;
} {
  const entry = (
    manager as unknown as {
      pending: Map<
        string,
        {
          callbackError?: string;
          callbackReceived?: { code: string; state: string };
          expiresAtMs: number;
        }
      >;
    }
  ).pending.get(cacheKey);

  if (!entry) {
    throw new Error(`Missing auth code entry ${cacheKey}`);
  }

  return entry;
}

function getDeviceEntry(
  manager: DeviceCodeFlowManager,
  cacheKey: string,
): { interval: number; expiresAtMs: number } {
  const entry = (
    manager as unknown as {
      pending: Map<string, { interval: number; expiresAtMs: number }>;
    }
  ).pending.get(cacheKey);

  if (!entry) {
    throw new Error(`Missing device entry ${cacheKey}`);
  }

  return entry;
}

async function seedDeviceFlow(
  cacheKey: string,
): Promise<DeviceCodeFlowManager> {
  const manager = new DeviceCodeFlowManager();

  nock('https://auth.example.com')
    .post('/device')
    .reply(200, {
      device_code: `${cacheKey}-code`,
      user_code: 'USER-CODE',
      verification_uri: 'https://auth.example.com/device',
      expires_in: 600,
      interval: 5,
    });

  await manager.startDeviceAuth({
    cacheKey,
    deviceAuthorizationEndpoint: 'https://auth.example.com/device',
    tokenUrl: 'https://auth.example.com/oauth/token',
    clientId: 'client',
    clientSecret: 'secret',
    scopes: [],
    tokenEndpointAuthMethod: 'client_secret_basic',
  });

  return manager;
}

async function loadFixtureApi(name: string): Promise<LoadedApi> {
  const registry = await loadApiRegistry(buildConfig(), {});
  const api = registry.byName.get(name);
  if (!api) {
    throw new Error(`Missing fixture API ${name}`);
  }
  return api;
}

function buildConfig(): RootConfig {
  return {
    version: 1,
    apis: [
      {
        name: 'pet-api',
        specPath: path.join(fixturesDir, 'pet-api.yaml'),
      },
    ],
  };
}

function buildInlineApi(
  name: string,
  securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject>,
): LoadedApi {
  const schemeName = Object.keys(securitySchemes)[0];
  const endpoint: EndpointDefinition = {
    endpointId: 'inlineEndpoint',
    method: 'get',
    path: '/inline',
    operationId: 'inlineEndpoint',
    operation: {
      security: [{ [schemeName]: [] }],
      responses: { '200': { description: 'ok' } },
    },
    pathItem: {},
  };

  return {
    config: {
      name,
      baseUrl: 'https://api.example.com',
    },
    schemaPath: 'inline',
    schema: {
      openapi: '3.0.3',
      info: { title: name, version: '1.0.0' },
      paths: {},
      components: {
        securitySchemes,
      },
    },
    baseUrl: 'https://api.example.com',
    endpoints: [endpoint],
    endpointById: new Map([[endpoint.endpointId, endpoint]]),
    authSchemeNames: Object.keys(securitySchemes),
  };
}
