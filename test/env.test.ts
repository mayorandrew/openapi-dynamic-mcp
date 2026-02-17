import { describe, expect, it } from "vitest";
import {
  normalizeEnvSegment,
  readApiBaseUrl,
  readApiExtraHeaders,
  readApiKeyValue,
  readOAuthClientCredentials
} from "../src/auth/env.js";

describe("env helpers", () => {
  it("normalizes segments", () => {
    expect(normalizeEnvSegment("pet-api")).toBe("PET_API");
    expect(normalizeEnvSegment(" Pet API (prod) ")).toBe("PET_API_PROD");
  });

  it("reads api and scheme vars", () => {
    const env = {
      PET_API_BASE_URL: "https://override.example.com",
      PET_API_HEADERS: '{"X-Tenant":"acme"}',
      PET_API_APIKEYAUTH_API_KEY: "secret",
      PET_API_OAUTHCC_CLIENT_ID: "client",
      PET_API_OAUTHCC_CLIENT_SECRET: "pass",
      PET_API_OAUTHCC_TOKEN_URL: "https://auth.example.com/token",
      PET_API_OAUTHCC_SCOPES: "read:pets write:pets",
      PET_API_OAUTHCC_TOKEN_AUTH_METHOD: "client_secret_basic"
    } satisfies NodeJS.ProcessEnv;

    expect(readApiBaseUrl("pet-api", env)).toBe("https://override.example.com");
    expect(readApiExtraHeaders("pet-api", env)).toEqual({ "X-Tenant": "acme" });
    expect(readApiKeyValue("pet-api", "ApiKeyAuth", env)).toBe("secret");
    expect(readOAuthClientCredentials("pet-api", "OAuthCC", env)).toEqual({
      clientId: "client",
      clientSecret: "pass",
      tokenUrl: "https://auth.example.com/token",
      scopes: ["read:pets", "write:pets"],
      tokenAuthMethod: "client_secret_basic"
    });
  });
});
