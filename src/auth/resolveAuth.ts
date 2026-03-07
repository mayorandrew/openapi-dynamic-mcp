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
import { OAuthClient, type InteractiveAuthResult } from './oauthClient.js';
import { OpenApiMcpError } from '../errors.js';
import type {
  EndpointDefinition,
  LoadedApi,
  ResolvedAuthResult,
  ResolvedAuthScheme,
  SchemeOauth2Config,
} from '../types.js';

interface ResolveAuthInput {
  api: LoadedApi;
  endpoint: EndpointDefinition;
  oauthClient: OAuthClient;
  env?: NodeJS.ProcessEnv;
}

interface RequirementFailure {
  requirement: string[];
  reason: string;
  missingEnv?: string[];
}

export async function resolveAuth({
  api,
  endpoint,
  oauthClient,
  env = process.env,
}: ResolveAuthInput): Promise<ResolvedAuthResult> {
  const requirements = endpoint.operation.security ?? api.schema.security ?? [];
  if (!requirements || requirements.length === 0) {
    return { authUsed: [], schemes: [] };
  }

  const securitySchemes = api.schema.components?.securitySchemes ?? {};
  const failures: RequirementFailure[] = [];

  for (const requirementObject of requirements) {
    if (Object.keys(requirementObject).length === 0) {
      return { authUsed: [], schemes: [] };
    }

    const resolved: ResolvedAuthScheme[] = [];
    const missingEnv = new Set<string>();
    let failedReason: string | undefined;

    for (const [schemeName, requestedScopes] of Object.entries(
      requirementObject,
    )) {
      const scheme = securitySchemes[schemeName];
      if (!scheme || '$ref' in scheme) {
        failedReason = `Security scheme '${schemeName}' not found or unresolved`;
        break;
      }

      if (scheme.type === 'apiKey') {
        const value = readApiKeyValue(api.config.name, schemeName, env);
        if (!value) {
          missingEnv.add(
            `${schemePrefix(api.config.name, schemeName)}_API_KEY`,
          );
          failedReason = `Missing API key for scheme '${schemeName}'`;
          break;
        }

        resolved.push({
          type: 'apiKey',
          schemeName,
          in: scheme.in as 'query' | 'header' | 'cookie',
          name: scheme.name,
          value,
        });
        continue;
      }

      if (scheme.type === 'oauth2') {
        const oauth2Result = await resolveOAuth2Scheme({
          api,
          schemeName,
          scheme,
          requestedScopes,
          oauthClient,
          env,
        });
        if ('interactiveAuth' in oauth2Result) {
          return {
            authUsed: [],
            schemes: [],
            interactiveAuth: oauth2Result.interactiveAuth,
          };
        }
        if ('failedReason' in oauth2Result) {
          for (const e of oauth2Result.missingEnv) missingEnv.add(e);
          failedReason = oauth2Result.failedReason;
          break;
        }
        resolved.push({
          type: 'oauth2',
          schemeName,
          token: oauth2Result.token,
        });
        continue;
      }

      if (scheme.type === 'http') {
        const schemeLower = scheme.scheme.toLowerCase();
        if (schemeLower !== 'bearer' && schemeLower !== 'basic') {
          failedReason = `HTTP auth scheme '${schemeLower}' is not supported`;
          break;
        }

        const fromEnv = readHttpAuthCredentials(
          api.config.name,
          schemeName,
          env,
        );
        if (schemeLower === 'bearer') {
          if (!fromEnv.token) {
            missingEnv.add(
              `${schemePrefix(api.config.name, schemeName)}_TOKEN`,
            );
            failedReason = `Missing Bearer token for scheme '${schemeName}'`;
            break;
          }
          resolved.push({
            type: 'http',
            schemeName,
            scheme: 'bearer',
            token: fromEnv.token,
          });
        } else if (schemeLower === 'basic') {
          if (!fromEnv.username || !fromEnv.password) {
            missingEnv.add(
              `${schemePrefix(api.config.name, schemeName)}_USERNAME`,
            );
            missingEnv.add(
              `${schemePrefix(api.config.name, schemeName)}_PASSWORD`,
            );
            failedReason = `Missing Basic auth credentials for scheme '${schemeName}'`;
            break;
          }
          resolved.push({
            type: 'http',
            schemeName,
            scheme: 'basic',
            username: fromEnv.username,
            password: fromEnv.password,
          });
        }
        continue;
      }

      failedReason = `Unsupported security scheme type '${scheme.type}' for '${schemeName}'`;
      break;
    }

    if (!failedReason) {
      return {
        authUsed: resolved.map((item) => item.schemeName),
        schemes: resolved,
      };
    }

    failures.push({
      requirement: Object.keys(requirementObject),
      reason: failedReason,
      missingEnv: [...missingEnv],
    });
  }

  const allMissingEnv = [
    ...new Set(failures.flatMap((f) => f.missingEnv ?? [])),
  ];
  const envHint =
    allMissingEnv.length > 0
      ? `. Set environment variable(s): ${allMissingEnv.join(', ')}`
      : '';

  throw new OpenApiMcpError(
    'AUTH_ERROR',
    `Could not resolve authentication for '${api.config.name}'${envHint}`,
    {
      endpointId: endpoint.endpointId,
      failures,
    },
  );
}

interface OAuth2SchemeInput {
  api: LoadedApi;
  schemeName: string;
  scheme: {
    flows: Record<
      string,
      {
        tokenUrl?: string;
        authorizationUrl?: string;
        scopes?: Record<string, string>;
      }
    >;
  };
  requestedScopes: string[] | undefined;
  oauthClient: OAuthClient;
  env: NodeJS.ProcessEnv;
}

type OAuth2SchemeResult =
  | { token: string }
  | { interactiveAuth: InteractiveAuthResult }
  | { failedReason: string; missingEnv: string[] };

function getSchemeConfig(
  api: LoadedApi,
  schemeName: string,
): SchemeOauth2Config | undefined {
  return api.config.oauth2Schemes?.[schemeName];
}

async function resolveOAuth2Scheme(
  input: OAuth2SchemeInput,
): Promise<OAuth2SchemeResult> {
  const { api, schemeName, scheme, requestedScopes, oauthClient, env } = input;
  const prefix = schemePrefix(api.config.name, schemeName);
  const schemeConfig = getSchemeConfig(api, schemeName);

  // 1. Pre-obtained token
  const preObtainedToken = readOAuthAccessToken(
    api.config.name,
    schemeName,
    env,
  );
  if (preObtainedToken) {
    return { token: preObtainedToken };
  }

  const ccFlow = scheme.flows.clientCredentials;
  const passwordFlow = scheme.flows.password;
  const authCodeFlow = scheme.flows.authorizationCode;

  // Read client credentials (needed by all grant flows)
  const fromEnv = readOAuthClientCredentials(api.config.name, schemeName, env);
  const clientId = fromEnv.clientId;
  const clientSecret = fromEnv.clientSecret;

  if (!clientId || !clientSecret) {
    return {
      failedReason: `Missing OAuth2 client credentials for '${schemeName}'`,
      missingEnv: [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`],
    };
  }

  // Resolve common params
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
    scopes.sort().join(','),
  ].join('|');

  // 2. Client credentials flow (automatic)
  if (ccFlow) {
    const token = await oauthClient.getClientCredentialsToken({
      cacheKey,
      tokenUrl,
      clientId,
      clientSecret,
      scopes,
      tokenEndpointAuthMethod,
    });
    return { token };
  }

  // 3. Password flow (automatic)
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
    const token = await oauthClient.getPasswordGrantToken({
      cacheKey,
      tokenUrl,
      clientId,
      clientSecret,
      scopes,
      tokenEndpointAuthMethod,
      username: passwordCreds.username,
      password: passwordCreds.password,
    });
    return { token };
  }

  // 4. Interactive flows (authorizationCode / implicit)
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
      if ('token' in result) return { token: result.token };
      return { interactiveAuth: result };
    }

    // authorization_code flow
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
    if ('token' in result) return { token: result.token };
    return { interactiveAuth: result };
  }

  // No supported flow
  return {
    failedReason: `Scheme '${schemeName}' has no supported OAuth2 flow`,
    missingEnv: [`${prefix}_ACCESS_TOKEN`],
  };
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

  // Auto-detect: if device endpoint is available, prefer device code
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
