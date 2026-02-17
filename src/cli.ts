#!/usr/bin/env node
import { loadConfig } from "./config/loadConfig.js";
import { OAuthClient } from "./auth/oauthClient.js";
import { OpenApiMcpError } from "./errors.js";
import { startMcpServer } from "./mcp/server.js";
import { loadApiRegistry } from "./openapi/loadSpec.js";

function parseConfigPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--config") {
      const value = argv[i + 1];
      if (!value) {
        throw new OpenApiMcpError("CONFIG_ERROR", "Missing value for --config");
      }
      return value;
    }
  }

  throw new OpenApiMcpError("CONFIG_ERROR", "Missing required argument --config");
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const configPath = parseConfigPath(argv);
  const config = await loadConfig(configPath);
  const registry = await loadApiRegistry(config, process.env);

  console.error(`[openapi-mcp] loaded ${registry.byName.size} API(s)`);
  for (const api of registry.byName.values()) {
    console.error(
      `[openapi-mcp] api=${api.config.name} endpoints=${api.endpoints.length} authSchemes=${api.authSchemeNames.join(",")}`
    );
  }

  await startMcpServer({
    registry,
    oauthClient: new OAuthClient(),
    env: process.env
  });
}

runCli().catch((error: unknown) => {
  if (error instanceof OpenApiMcpError) {
    console.error(
      JSON.stringify(
        {
          code: error.code,
          message: error.message,
          details: error.details
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }

  process.exit(1);
});
