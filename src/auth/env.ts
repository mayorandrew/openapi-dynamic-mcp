import { OpenApiMcpError } from "../errors.js";

export interface OAuthClientCredentialsFromEnv {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes?: string[];
  tokenAuthMethod?: "client_secret_basic" | "client_secret_post";
}

export function normalizeEnvSegment(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function apiPrefix(apiName: string): string {
  return normalizeEnvSegment(apiName);
}

export function schemePrefix(apiName: string, schemeName: string): string {
  return `${apiPrefix(apiName)}_${normalizeEnvSegment(schemeName)}`;
}

export function readApiBaseUrl(apiName: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`${apiPrefix(apiName)}_BASE_URL`];
}

export function readApiExtraHeaders(
  apiName: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const raw = env[`${apiPrefix(apiName)}_HEADERS`];
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OpenApiMcpError(
      "CONFIG_ERROR",
      `Invalid JSON in ${apiPrefix(apiName)}_HEADERS`,
      { value: raw }
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OpenApiMcpError(
      "CONFIG_ERROR",
      `${apiPrefix(apiName)}_HEADERS must be a JSON object`
    );
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new OpenApiMcpError(
        "CONFIG_ERROR",
        `${apiPrefix(apiName)}_HEADERS values must be strings`,
        { key }
      );
    }
    out[key] = value;
  }

  return out;
}

export function readApiKeyValue(
  apiName: string,
  schemeName: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return env[`${schemePrefix(apiName, schemeName)}_API_KEY`];
}

export function readOAuthClientCredentials(
  apiName: string,
  schemeName: string,
  env: NodeJS.ProcessEnv = process.env
): OAuthClientCredentialsFromEnv {
  const prefix = schemePrefix(apiName, schemeName);
  const scopesRaw = env[`${prefix}_SCOPES`];
  const tokenAuthMethodRaw = env[`${prefix}_TOKEN_AUTH_METHOD`];
  let tokenAuthMethod: "client_secret_basic" | "client_secret_post" | undefined;
  if (tokenAuthMethodRaw === "client_secret_basic" || tokenAuthMethodRaw === "client_secret_post") {
    tokenAuthMethod = tokenAuthMethodRaw;
  } else if (tokenAuthMethodRaw) {
    throw new OpenApiMcpError(
      "CONFIG_ERROR",
      `Invalid ${prefix}_TOKEN_AUTH_METHOD value`,
      { value: tokenAuthMethodRaw }
    );
  }

  return {
    clientId: env[`${prefix}_CLIENT_ID`],
    clientSecret: env[`${prefix}_CLIENT_SECRET`],
    tokenUrl: env[`${prefix}_TOKEN_URL`],
    scopes: scopesRaw ? scopesRaw.split(/\s+/).filter(Boolean) : undefined,
    tokenAuthMethod
  };
}
