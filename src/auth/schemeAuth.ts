import type { OpenAPIV3 } from 'openapi-types';
import {
  readApiKeyValue,
  readHttpAuthCredentials,
  readOAuthAccessToken,
  readOAuthAuthMethod,
  readOAuthClientCredentials,
  readOAuthDeviceAuthEndpoint,
  readOAuthPasswordCredentials,
  readOAuthPkce,
  readOAuthRedirectPort,
  schemePrefix,
} from './env.js';
import {
  OAuthClient,
  type InteractiveAuthResult,
  type OAuthTokenResult,
} from './oauthClient.js';
import { OpenApiMcpError } from '../errors.js';
import type { LoadedApi, SchemeOauth2Config } from '../types.js';
import type { AuthStore } from './authStore.js';

export interface RequirementFailure {
  requirement: string[];
  reason: string;
  missingEnv?: string[];
}

export type ResolvedSchemeResult =
  | {
      status: 'resolved';
      authUsed: string;
      resolved:
        | {
            type: 'apiKey';
            schemeName: string;
            in: 'query' | 'header' | 'cookie';
            name: string;
            value: string;
          }
        | {
            type: 'oauth2';
            schemeName: string;
            token: string;
          }
        | {
            type: 'http';
            schemeName: string;
            scheme: 'bearer' | 'basic';
            token?: string;
            username?: string;
            password?: string;
          };
    }
  | {
      status: 'interactive';
      interactiveAuth: InteractiveAuthResult;
    }
  | {
      status: 'failed';
      failedReason: string;
      missingEnv: string[];
    };

export interface SelectedSchemeStoredAuth {
  kind: 'oauth2' | 'apiKey' | 'http-bearer';
  apiName: string;
  schemeName: string;
  token: string;
  expiresAt?: number;
}

interface ResolveSchemeInput {
  api: LoadedApi;
  schemeName: string;
  requestedScopes?: string[];
  oauthClient: OAuthClient;
  env: NodeJS.ProcessEnv;
  authStore?: AuthStore;
}

export async function resolveSchemeForRequest(
  input: ResolveSchemeInput,
): Promise<ResolvedSchemeResult> {
  const scheme = getSecurityScheme(input.api, input.schemeName);

  if (scheme.type === 'apiKey') {
    const value = readApiKeyValue(
      input.api.config.name,
      input.schemeName,
      input.env,
    );
    const stored = await input.authStore?.getToken(
      input.api.config.name,
      input.schemeName,
    );
    const token = value ?? stored?.token;
    if (!token) {
      return {
        status: 'failed',
        failedReason: `Missing API key for scheme '${input.schemeName}'`,
        missingEnv: [
          `${schemePrefix(input.api.config.name, input.schemeName)}_API_KEY`,
        ],
      };
    }

    return {
      status: 'resolved',
      authUsed: input.schemeName,
      resolved: {
        type: 'apiKey',
        schemeName: input.schemeName,
        in: scheme.in as 'query' | 'header' | 'cookie',
        name: scheme.name,
        value: token,
      },
    };
  }

  if (scheme.type === 'http') {
    const schemeLower = scheme.scheme.toLowerCase();
    if (schemeLower !== 'bearer' && schemeLower !== 'basic') {
      return {
        status: 'failed',
        failedReason: `HTTP auth scheme '${schemeLower}' is not supported`,
        missingEnv: [],
      };
    }

    const fromEnv = readHttpAuthCredentials(
      input.api.config.name,
      input.schemeName,
      input.env,
    );
    const stored = await input.authStore?.getToken(
      input.api.config.name,
      input.schemeName,
    );

    if (schemeLower === 'bearer') {
      const token = fromEnv.token ?? stored?.token;
      if (!token) {
        return {
          status: 'failed',
          failedReason: `Missing Bearer token for scheme '${input.schemeName}'`,
          missingEnv: [
            `${schemePrefix(input.api.config.name, input.schemeName)}_TOKEN`,
          ],
        };
      }
      return {
        status: 'resolved',
        authUsed: input.schemeName,
        resolved: {
          type: 'http',
          schemeName: input.schemeName,
          scheme: 'bearer',
          token,
        },
      };
    }

    if (!fromEnv.username || !fromEnv.password) {
      return {
        status: 'failed',
        failedReason: `Missing Basic auth credentials for scheme '${input.schemeName}'`,
        missingEnv: [
          `${schemePrefix(input.api.config.name, input.schemeName)}_USERNAME`,
          `${schemePrefix(input.api.config.name, input.schemeName)}_PASSWORD`,
        ],
      };
    }

    return {
      status: 'resolved',
      authUsed: input.schemeName,
      resolved: {
        type: 'http',
        schemeName: input.schemeName,
        scheme: 'basic',
        username: fromEnv.username,
        password: fromEnv.password,
      },
    };
  }

  if (scheme.type === 'oauth2') {
    return resolveOAuth2SchemeForRequest(input, scheme);
  }

  return {
    status: 'failed',
    failedReason: `Unsupported security scheme type '${scheme.type}' for '${input.schemeName}'`,
    missingEnv: [],
  };
}

export async function authenticateSelectedScheme(
  input: ResolveSchemeInput & {
    token?: string;
    onInteractive?: (payload: InteractiveAuthResult) => void;
  },
): Promise<SelectedSchemeStoredAuth> {
  const scheme = getSecurityScheme(input.api, input.schemeName);

  if (scheme.type === 'apiKey') {
    if (!input.token) {
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        `Scheme '${input.schemeName}' requires --token`,
      );
    }
    return {
      kind: 'apiKey',
      apiName: input.api.config.name,
      schemeName: input.schemeName,
      token: input.token,
    };
  }

  if (scheme.type === 'http') {
    const schemeLower = scheme.scheme.toLowerCase();
    if (schemeLower === 'basic') {
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        `HTTP basic scheme '${input.schemeName}' is not supported by the auth command`,
      );
    }
    if (schemeLower !== 'bearer') {
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        `HTTP auth scheme '${schemeLower}' is not supported`,
      );
    }
    if (!input.token) {
      throw new OpenApiMcpError(
        'AUTH_ERROR',
        `Scheme '${input.schemeName}' requires --token`,
      );
    }
    return {
      kind: 'http-bearer',
      apiName: input.api.config.name,
      schemeName: input.schemeName,
      token: input.token,
    };
  }

  if (input.token) {
    throw new OpenApiMcpError(
      'AUTH_ERROR',
      `Scheme '${input.schemeName}' does not accept --token`,
    );
  }

  const oauth = await resolveOAuth2TokenForStorage({
    ...input,
    scheme: scheme as Extract<
      OpenAPIV3.SecuritySchemeObject,
      { type: 'oauth2' }
    >,
  });

  return {
    kind: 'oauth2',
    apiName: input.api.config.name,
    schemeName: input.schemeName,
    token: oauth.accessToken,
    expiresAt:
      oauth.expiresIn !== undefined
        ? Date.now() + oauth.expiresIn * 1000
        : undefined,
  };
}

export function getSecurityScheme(
  api: LoadedApi,
  schemeName: string,
): OpenAPIV3.SecuritySchemeObject {
  const securitySchemes = api.schema.components?.securitySchemes ?? {};
  const actualName = Object.keys(securitySchemes).find(
    (name) => name.toLowerCase() === schemeName.toLowerCase(),
  );
  if (!actualName) {
    throw new OpenApiMcpError(
      'AUTH_ERROR',
      `Security scheme '${schemeName}' not found for '${api.config.name}'`,
    );
  }

  const scheme = securitySchemes[actualName];
  if (!scheme || '$ref' in scheme) {
    throw new OpenApiMcpError(
      'AUTH_ERROR',
      `Security scheme '${actualName}' not found or unresolved`,
    );
  }

  return scheme;
}

async function resolveOAuth2SchemeForRequest(
  input: ResolveSchemeInput,
  scheme: Extract<OpenAPIV3.SecuritySchemeObject, { type: 'oauth2' }>,
): Promise<ResolvedSchemeResult> {
  const stored = await input.authStore?.getToken(
    input.api.config.name,
    input.schemeName,
  );
  const preObtainedToken = readOAuthAccessToken(
    input.api.config.name,
    input.schemeName,
    input.env,
  );
  if (preObtainedToken || stored?.token) {
    return {
      status: 'resolved',
      authUsed: input.schemeName,
      resolved: {
        type: 'oauth2',
        schemeName: input.schemeName,
        token: preObtainedToken ?? stored!.token,
      },
    };
  }

  const oauthResult = await resolveOAuth2Token({
    ...input,
    scheme,
    mode: 'request',
  });

  if ('interactiveAuth' in oauthResult) {
    return {
      status: 'interactive',
      interactiveAuth: oauthResult.interactiveAuth,
    };
  }

  if ('failedReason' in oauthResult) {
    return {
      status: 'failed',
      failedReason: oauthResult.failedReason,
      missingEnv: oauthResult.missingEnv,
    };
  }

  return {
    status: 'resolved',
    authUsed: input.schemeName,
    resolved: {
      type: 'oauth2',
      schemeName: input.schemeName,
      token: oauthResult.token.accessToken,
    },
  };
}

async function resolveOAuth2TokenForStorage(
  input: ResolveSchemeInput & {
    scheme: Extract<OpenAPIV3.SecuritySchemeObject, { type: 'oauth2' }>;
    onInteractive?: (payload: InteractiveAuthResult) => void;
  },
): Promise<OAuthTokenResult> {
  const preObtainedToken = readOAuthAccessToken(
    input.api.config.name,
    input.schemeName,
    input.env,
  );
  if (preObtainedToken) {
    return { accessToken: preObtainedToken };
  }

  const oauthResult = await resolveOAuth2Token({
    ...input,
    mode: 'auth-command',
  });
  if ('failedReason' in oauthResult) {
    const envHint =
      oauthResult.missingEnv.length > 0
        ? ` Missing env: ${oauthResult.missingEnv.join(', ')}`
        : '';
    throw new OpenApiMcpError(
      'AUTH_ERROR',
      `${oauthResult.failedReason}.${envHint}`.trim(),
    );
  }
  if ('interactiveAuth' in oauthResult) {
    input.onInteractive?.(oauthResult.interactiveAuth);
    return waitForInteractiveOAuthToken({
      ...input,
      schemeName: input.schemeName,
    });
  }
  return oauthResult.token;
}

async function waitForInteractiveOAuthToken(
  input: ResolveSchemeInput & {
    scheme: Extract<OpenAPIV3.SecuritySchemeObject, { type: 'oauth2' }>;
  },
): Promise<OAuthTokenResult> {
  while (true) {
    await sleep(1500);
    const next = await resolveOAuth2Token({
      ...input,
      mode: 'request',
    });
    if ('token' in next) {
      return next.token;
    }
    if ('failedReason' in next) {
      throw new OpenApiMcpError('AUTH_ERROR', next.failedReason, {
        missingEnv: next.missingEnv,
      });
    }
  }
}

async function resolveOAuth2Token(
  input: ResolveSchemeInput & {
    scheme: Extract<OpenAPIV3.SecuritySchemeObject, { type: 'oauth2' }>;
    mode: 'request' | 'auth-command';
  },
): Promise<
  | { token: OAuthTokenResult }
  | { interactiveAuth: InteractiveAuthResult }
  | { failedReason: string; missingEnv: string[] }
> {
  const { api, schemeName, scheme, requestedScopes, oauthClient, env } = input;
  const prefix = schemePrefix(api.config.name, schemeName);
  const schemeConfig = getSchemeConfig(api, schemeName);

  const ccFlow = scheme.flows.clientCredentials;
  const passwordFlow = scheme.flows.password;
  const authCodeFlow = scheme.flows.authorizationCode;

  const fromEnv = readOAuthClientCredentials(api.config.name, schemeName, env);
  const clientId = fromEnv.clientId;
  const clientSecret = fromEnv.clientSecret;

  if (!clientId || !clientSecret) {
    return {
      failedReason: `Missing OAuth2 client credentials for '${schemeName}'`,
      missingEnv: [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`],
    };
  }

  const tokenUrl =
    fromEnv.tokenUrl ??
    schemeConfig?.tokenUrl ??
    api.config.oauth2?.tokenUrlOverride ??
    (ccFlow ?? passwordFlow ?? authCodeFlow)?.tokenUrl;
  if (!tokenUrl) {
    return {
      failedReason: `No OAuth2 token URL resolved for scheme '${schemeName}'`,
      missingEnv: [],
    };
  }
  const tokenEndpointAuthMethod =
    fromEnv.tokenAuthMethod ??
    schemeConfig?.tokenEndpointAuthMethod ??
    api.config.oauth2?.tokenEndpointAuthMethod ??
    'client_secret_basic';

  const activeFlow = ccFlow ?? passwordFlow ?? authCodeFlow;
  const scopes = resolveScopes(
    requestedScopes,
    fromEnv.scopes,
    schemeConfig?.scopes ?? api.config.oauth2?.scopes,
    activeFlow ?? {},
  );
  const cacheKey = [
    api.config.name,
    schemeName,
    clientId,
    tokenUrl,
    tokenEndpointAuthMethod,
    [...scopes].sort().join(','),
  ].join('|');

  if (ccFlow) {
    return {
      token: await oauthClient.getClientCredentialsToken({
        cacheKey,
        tokenUrl,
        clientId,
        clientSecret,
        scopes,
        tokenEndpointAuthMethod,
      }),
    };
  }

  if (passwordFlow) {
    const passwordCreds = readOAuthPasswordCredentials(
      api.config.name,
      schemeName,
      env,
    );
    if (!passwordCreds.username || !passwordCreds.password) {
      return {
        failedReason: `Missing OAuth2 password credentials for '${schemeName}'`,
        missingEnv: [`${prefix}_USERNAME`, `${prefix}_PASSWORD`],
      };
    }
    return {
      token: await oauthClient.getPasswordGrantToken({
        cacheKey,
        tokenUrl,
        clientId,
        clientSecret,
        scopes,
        tokenEndpointAuthMethod,
        username: passwordCreds.username,
        password: passwordCreds.password,
      }),
    };
  }

  if (authCodeFlow) {
    const authMethod = resolveInteractiveAuthMethod(
      api,
      schemeName,
      env,
      schemeConfig,
    );
    const deviceAuthEndpoint =
      readOAuthDeviceAuthEndpoint(api.config.name, schemeName, env) ??
      schemeConfig?.deviceAuthorizationEndpoint;

    if (authMethod === 'device_code') {
      if (!deviceAuthEndpoint) {
        return {
          failedReason: `Device authorization endpoint not configured for '${schemeName}'`,
          missingEnv: [`${prefix}_DEVICE_AUTHORIZATION_ENDPOINT`],
        };
      }
      const result = await oauthClient.startOrPollDeviceCode({
        cacheKey,
        deviceAuthorizationEndpoint: deviceAuthEndpoint,
        tokenUrl,
        clientId,
        clientSecret,
        scopes,
        tokenEndpointAuthMethod,
      });
      if ('accessToken' in result) {
        return { token: result };
      }
      return { interactiveAuth: result };
    }

    const authorizationEndpoint = authCodeFlow.authorizationUrl;
    if (!authorizationEndpoint) {
      return {
        failedReason: `No authorization endpoint for scheme '${schemeName}'`,
        missingEnv: [],
      };
    }
    const pkce =
      readOAuthPkce(api.config.name, schemeName, env) ??
      schemeConfig?.pkce ??
      true;
    const redirectPort = readOAuthRedirectPort(
      api.config.name,
      schemeName,
      env,
    );
    const result = await oauthClient.startOrPollAuthCode({
      cacheKey,
      authorizationEndpoint,
      tokenUrl,
      clientId,
      clientSecret,
      scopes,
      tokenEndpointAuthMethod,
      pkce,
      redirectPort,
    });
    if ('accessToken' in result) {
      return { token: result };
    }
    return { interactiveAuth: result };
  }

  return {
    failedReason: `Scheme '${schemeName}' has no supported OAuth2 flow`,
    missingEnv: [`${prefix}_ACCESS_TOKEN`],
  };
}

function getSchemeConfig(
  api: LoadedApi,
  schemeName: string,
): SchemeOauth2Config | undefined {
  const matchedName = Object.keys(api.config.oauth2Schemes ?? {}).find(
    (name) => name.toLowerCase() === schemeName.toLowerCase(),
  );
  return matchedName ? api.config.oauth2Schemes?.[matchedName] : undefined;
}

function resolveInteractiveAuthMethod(
  api: LoadedApi,
  schemeName: string,
  env: NodeJS.ProcessEnv,
  schemeConfig: SchemeOauth2Config | undefined,
): 'device_code' | 'authorization_code' {
  const envMethod = readOAuthAuthMethod(api.config.name, schemeName, env);
  if (envMethod) return envMethod;

  if (schemeConfig?.authMethod) return schemeConfig.authMethod;

  const deviceEndpoint = readOAuthDeviceAuthEndpoint(
    api.config.name,
    schemeName,
    env,
  );
  if (deviceEndpoint || schemeConfig?.deviceAuthorizationEndpoint) {
    return 'device_code';
  }

  return 'authorization_code';
}

function resolveScopes(
  requestedScopes: string[] | undefined,
  envScopes: string[] | undefined,
  configScopes: string[] | undefined,
  flow: { scopes?: Record<string, string> },
): string[] {
  if (envScopes && envScopes.length > 0) {
    return envScopes;
  }

  if (configScopes && configScopes.length > 0) {
    return configScopes;
  }

  if (requestedScopes && requestedScopes.length > 0) {
    return requestedScopes;
  }

  return Object.keys(flow.scopes ?? {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
