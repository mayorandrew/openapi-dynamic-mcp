import {
  readApiKeyValue,
  readHttpAuthCredentials,
  readOAuthClientCredentials,
  schemePrefix,
} from "./env.js";
import { OAuthClient } from "./oauthClient.js";
import { OpenApiMcpError } from "../errors.js";
import type {
  EndpointDefinition,
  LoadedApi,
  ResolvedAuthResult,
  ResolvedAuthScheme,
} from "../types.js";

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
      if (!scheme || "$ref" in scheme) {
        failedReason = `Security scheme '${schemeName}' not found or unresolved`;
        break;
      }

      if (scheme.type === "apiKey") {
        const value = readApiKeyValue(api.config.name, schemeName, env);
        if (!value) {
          missingEnv.add(
            `${schemePrefix(api.config.name, schemeName)}_API_KEY`,
          );
          failedReason = `Missing API key for scheme '${schemeName}'`;
          break;
        }

        resolved.push({
          type: "apiKey",
          schemeName,
          in: scheme.in as "query" | "header" | "cookie",
          name: scheme.name,
          value,
        });
        continue;
      }

      if (scheme.type === "oauth2") {
        const flow = scheme.flows.clientCredentials;
        if (!flow) {
          failedReason = `Scheme '${schemeName}' does not support clientCredentials flow`;
          break;
        }

        const fromEnv = readOAuthClientCredentials(
          api.config.name,
          schemeName,
          env,
        );
        const clientId = fromEnv.clientId;
        const clientSecret = fromEnv.clientSecret;

        if (!clientId || !clientSecret) {
          missingEnv.add(
            `${schemePrefix(api.config.name, schemeName)}_CLIENT_ID`,
          );
          missingEnv.add(
            `${schemePrefix(api.config.name, schemeName)}_CLIENT_SECRET`,
          );
          failedReason = `Missing OAuth2 client credentials for '${schemeName}'`;
          break;
        }

        const tokenUrl =
          fromEnv.tokenUrl ??
          api.config.oauth2?.tokenUrlOverride ??
          flow.tokenUrl;
        if (!tokenUrl) {
          failedReason = `No OAuth2 token URL resolved for scheme '${schemeName}'`;
          break;
        }
        const tokenEndpointAuthMethod =
          fromEnv.tokenAuthMethod ??
          api.config.oauth2?.tokenEndpointAuthMethod ??
          "client_secret_basic";

        const scopes = resolveScopes(
          requestedScopes,
          fromEnv.scopes,
          api.config.oauth2?.scopes,
          flow,
        );
        const cacheKey = [
          api.config.name,
          schemeName,
          clientId,
          tokenUrl,
          tokenEndpointAuthMethod,
          scopes.sort().join(","),
        ].join("|");

        const token = await oauthClient.getClientCredentialsToken({
          cacheKey,
          tokenUrl,
          clientId,
          clientSecret,
          scopes,
          tokenEndpointAuthMethod,
        });

        resolved.push({
          type: "oauth2",
          schemeName,
          token,
        });
        continue;
      }

      if (scheme.type === "http") {
        const schemeLower = scheme.scheme.toLowerCase();
        if (schemeLower !== "bearer" && schemeLower !== "basic") {
          failedReason = `HTTP auth scheme '${schemeLower}' is not supported`;
          break;
        }

        const fromEnv = readHttpAuthCredentials(
          api.config.name,
          schemeName,
          env,
        );
        if (schemeLower === "bearer") {
          if (!fromEnv.token) {
            missingEnv.add(
              `${schemePrefix(api.config.name, schemeName)}_TOKEN`,
            );
            failedReason = `Missing Bearer token for scheme '${schemeName}'`;
            break;
          }
          resolved.push({
            type: "http",
            schemeName,
            scheme: "bearer",
            token: fromEnv.token,
          });
        } else if (schemeLower === "basic") {
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
            type: "http",
            schemeName,
            scheme: "basic",
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

  throw new OpenApiMcpError(
    "AUTH_ERROR",
    `Could not resolve authentication for '${api.config.name}'`,
    {
      endpointId: endpoint.endpointId,
      failures,
    },
  );
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
