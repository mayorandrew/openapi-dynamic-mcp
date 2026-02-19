import path from "node:path";
import nock from "nock";
import { afterEach, describe, expect, it } from "vitest";
import { OAuthClient } from "../src/auth/oauthClient.js";
import { resolveAuth } from "../src/auth/resolveAuth.js";
import { loadApiRegistry } from "../src/openapi/loadSpec.js";
import type { RootConfig } from "../src/types.js";

const fixturesDir = path.resolve("test/fixtures");

afterEach(() => {
  nock.cleanAll();
});

describe("resolveAuth", () => {
  it("uses fallback OR requirement when first requirement is not resolvable", async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get("pet-api");
    const endpoint = api?.endpointById.get("comboSecurity");

    expect(api).toBeDefined();
    expect(endpoint).toBeDefined();

    const auth = await resolveAuth({
      api: api!,
      endpoint: endpoint!,
      oauthClient: new OAuthClient(),
      env: {
        PET_API_QUERYKEY_API_KEY: "query-secret",
      },
    });

    expect(auth.authUsed).toEqual(["QueryKey"]);
    expect(auth.schemes).toHaveLength(1);
    expect(auth.schemes[0]).toMatchObject({
      type: "apiKey",
      in: "query",
    });
  });

  it("resolves combined AND requirement with OAuth token", async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get("pet-api");
    const endpoint = api?.endpointById.get("comboSecurity");

    nock("https://auth.example.com").post("/oauth/token").reply(200, {
      access_token: "token-1",
      token_type: "Bearer",
      expires_in: 3600,
    });

    const auth = await resolveAuth({
      api: api!,
      endpoint: endpoint!,
      oauthClient: new OAuthClient(),
      env: {
        PET_API_APIKEYAUTH_API_KEY: "header-secret",
        PET_API_OAUTHCC_CLIENT_ID: "client",
        PET_API_OAUTHCC_CLIENT_SECRET: "secret",
      },
    });

    expect(auth.authUsed).toEqual(["ApiKeyAuth", "OAuthCC"]);
    expect(auth.schemes).toHaveLength(2);
  });

  it("fails when no security requirement can be satisfied", async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get("pet-api");
    const endpoint = api?.endpointById.get("comboSecurity");

    await expect(
      resolveAuth({
        api: api!,
        endpoint: endpoint!,
        oauthClient: new OAuthClient(),
        env: {},
      }),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
  });

  it("resolves HTTP Bearer auth", async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get("pet-api");
    const endpoint = api?.endpointById.get("httpAuthSecurity");

    expect(api).toBeDefined();
    expect(endpoint).toBeDefined();

    const auth = await resolveAuth({
      api: api!,
      endpoint: endpoint!,
      oauthClient: new OAuthClient(),
      env: {
        PET_API_BEARERAUTH_TOKEN: "my-bearer-token",
      },
    });

    // It should pick the Bearer requirement since Basic fails
    expect(auth.authUsed).toEqual(["BearerAuth"]);
    expect(auth.schemes).toHaveLength(1);
    expect(auth.schemes[0]).toMatchObject({
      type: "http",
      scheme: "bearer",
      token: "my-bearer-token",
    });
  });

  it("resolves HTTP Basic auth", async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get("pet-api");
    const endpoint = api?.endpointById.get("httpAuthSecurity");

    const auth = await resolveAuth({
      api: api!,
      endpoint: endpoint!,
      oauthClient: new OAuthClient(),
      env: {
        PET_API_BASICAUTH_USERNAME: "alice",
        PET_API_BASICAUTH_PASSWORD: "super-secret",
      },
    });

    // Basic is the first option, and it succeeds
    expect(auth.authUsed).toEqual(["BasicAuth"]);
    expect(auth.schemes).toHaveLength(1);
    expect(auth.schemes[0]).toMatchObject({
      type: "http",
      scheme: "basic",
      username: "alice",
      password: "super-secret",
    });
  });
});

function buildConfig(): RootConfig {
  return {
    version: 1,
    apis: [
      {
        name: "pet-api",
        specPath: path.join(fixturesDir, "pet-api.yaml"),
      },
    ],
  };
}
