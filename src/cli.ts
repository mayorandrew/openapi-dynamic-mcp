#!/usr/bin/env node
import { command, option, run, string } from 'cmd-ts';
import { loadConfig } from './config/loadConfig.js';
import { OAuthClient } from './auth/oauthClient.js';
import { OpenApiMcpError } from './errors.js';
import { startMcpServer, version } from './mcp/server.js';
import { loadApiRegistry } from './openapi/loadSpec.js';

export async function runServer(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  const registry = await loadApiRegistry(config, process.env);

  console.error(`[openapi-mcp] loaded ${registry.byName.size} API(s)`);
  for (const api of registry.byName.values()) {
    console.error(
      `[openapi-mcp] api=${api.config.name} endpoints=${api.endpoints.length} authSchemes=${api.authSchemeNames.join(',')}`,
    );
  }

  await startMcpServer({
    registry,
    oauthClient: new OAuthClient(),
    env: process.env,
  });
}

const cmd = command({
  name: 'openapi-dynamic-mcp',
  description: 'MCP stdio server for OpenAPI APIs',
  version,
  args: {
    config: option({
      type: string,
      long: 'config',
      short: 'c',
      description: 'Path to YAML configuration file',
    }),
  },
  handler: ({ config }) => runServer(config),
});

run(cmd, process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof OpenApiMcpError) {
    console.error(
      JSON.stringify(
        {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        null,
        2,
      ),
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
