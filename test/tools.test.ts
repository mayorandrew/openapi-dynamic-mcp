import path from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OAuthClient } from "../src/auth/oauthClient.js";
import { loadApiRegistry } from "../src/openapi/loadSpec.js";
import type { RootConfig } from "../src/types.js";
import type { ToolContext } from "../src/mcp/context.js";
import { getApiSchemaTool } from "../src/mcp/tools/getApiSchema.js";
import { listApiEndpointsTool } from "../src/mcp/tools/listApiEndpoints.js";
import { listApisTool } from "../src/mcp/tools/listApis.js";
import { makeEndpointRequestTool } from "../src/mcp/tools/makeEndpointRequest.js";

const fixturesDir = path.resolve("test/fixtures");

let context: ToolContext;

beforeEach(async () => {
  const env: NodeJS.ProcessEnv = {
    PET_API_APIKEYAUTH_API_KEY: "key"
  };
  const registry = await loadApiRegistry(buildConfig(), env);
  context = {
    registry,
    oauthClient: new OAuthClient(),
    env
  };
});

afterEach(() => {
  nock.cleanAll();
});

describe("MCP tools", () => {
  it("lists APIs", async () => {
    const result = await listApisTool(context);
    expect(result.isError).toBeUndefined();
    const content = result.structuredContent as { apis: Array<{ name: string }> };
    expect(content.apis.map((api) => api.name)).toEqual(["pet-api"]);
  });

  it("lists endpoints with cursor", async () => {
    const first = await listApiEndpointsTool(context, {
      apiName: "pet-api",
      limit: 1
    });

    const firstPayload = first.structuredContent as {
      endpoints: Array<{ endpointId: string }>;
      nextCursor?: string;
    };
    expect(firstPayload.endpoints).toHaveLength(1);
    expect(firstPayload.nextCursor).toBeTruthy();

    const second = await listApiEndpointsTool(context, {
      apiName: "pet-api",
      limit: 2,
      cursor: firstPayload.nextCursor
    });
    const secondPayload = second.structuredContent as {
      endpoints: Array<{ endpointId: string }>;
    };
    expect(secondPayload.endpoints.length).toBeGreaterThan(0);
  });

  it("filters endpoints by search", async () => {
    const result = await listApiEndpointsTool(context, {
      apiName: "pet-api",
      search: "listpets"
    });

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      endpoints: Array<{ endpointId: string }>;
    };
    expect(payload.endpoints).toHaveLength(1);
    expect(payload.endpoints[0]?.endpointId).toBe("listPets");
  });

  it("reads schema pointer", async () => {
    const result = await getApiSchemaTool(context, {
      apiName: "pet-api",
      pointer: "/info/title"
    });
    const payload = result.structuredContent as {
      schema: string;
    };
    expect(payload.schema).toBe("Pet API");
  });

  it("returns structured error payload for unknown endpoint", async () => {
    const result = await makeEndpointRequestTool(context, {
      apiName: "pet-api",
      endpointId: "missing"
    });
    expect(result.isError).toBe(true);
    const payload = result.structuredContent as { code: string };
    expect(payload.code).toBe("ENDPOINT_NOT_FOUND");
  });

  it("executes make_endpoint_request", async () => {
    nock("https://api.example.com")
      .get("/v1/pets")
      .query(true)
      .reply(200, { ok: true }, { "content-type": "application/json" });

    const result = await makeEndpointRequestTool(context, {
      apiName: "pet-api",
      endpointId: "listPets"
    });

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      response: { status: number; bodyType: string };
    };
    expect(payload.response.status).toBe(200);
    expect(payload.response.bodyType).toBe("json");
  });

  it("supports retry429 overrides on make_endpoint_request", async () => {
    const scope = nock("https://api.example.com")
      .get("/v1/pets")
      .query(true)
      .reply(429, { error: "rate_limited" }, { "content-type": "application/json" })
      .get("/v1/pets")
      .query(true)
      .reply(200, { ok: true }, { "content-type": "application/json" });

    const result = await makeEndpointRequestTool(context, {
      apiName: "pet-api",
      endpointId: "listPets",
      retry429: {
        maxRetries: 1,
        baseDelayMs: 1,
        maxDelayMs: 5,
        jitterRatio: 0
      }
    });

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      response: { status: number };
    };
    expect(payload.response.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  it("validates retry429 override shape", async () => {
    const result = await makeEndpointRequestTool(context, {
      apiName: "pet-api",
      endpointId: "listPets",
      retry429: {
        jitterRatio: 2
      }
    });

    expect(result.isError).toBe(true);
    const payload = result.structuredContent as { code: string };
    expect(payload.code).toBe("REQUEST_ERROR");
  });
});

function buildConfig(): RootConfig {
  return {
    version: 1,
    apis: [
      {
        name: "pet-api",
        specPath: path.join(fixturesDir, "pet-api.yaml")
      }
    ]
  };
}
