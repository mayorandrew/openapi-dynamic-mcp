#!/usr/bin/env node
import {
  array,
  command,
  flag,
  multioption,
  option,
  optional,
  run,
  string,
  subcommands,
} from 'cmd-ts';
import { z } from 'zod';
import { AuthStore, resolveAuthStorePath } from './auth/authStore.js';
import { authenticateSelectedScheme } from './auth/schemeAuth.js';
import { loadConfig } from './config/loadConfig.js';
import { OpenApiMcpError } from './errors.js';
import { startMcpServer, version } from './mcp/server.js';
import { getToolDefinition, toolDefinitions } from './mcp/tools/registry.js';
import { loadApiRegistry } from './openapi/loadSpec.js';
import { applyJsonPathFields } from './output/jsonPath.js';
import { OAuthClient } from './auth/oauthClient.js';
import { toJsonSchemaCompat } from './vendor/mcpJsonSchema.js';

async function buildContext(configPath: string, authFile?: string) {
  const config = await loadConfig(configPath);
  const registry = await loadApiRegistry(config, process.env);
  return {
    registry,
    oauthClient: new OAuthClient(),
    authStore: new AuthStore(
      resolveAuthStorePath(configPath, authFile, process.env),
    ),
    env: process.env,
  };
}

export async function runServer(
  configPath: string,
  authFile?: string,
): Promise<void> {
  const context = await buildContext(configPath, authFile);

  console.error(`[openapi-mcp] loaded ${context.registry.byName.size} API(s)`);
  for (const api of context.registry.byName.values()) {
    console.error(
      `[openapi-mcp] api=${api.config.name} endpoints=${api.endpoints.length} authSchemes=${api.authSchemeNames.join(',')}`,
    );
  }

  await startMcpServer(context);
}

function parseJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new OpenApiMcpError('REQUEST_ERROR', 'Invalid JSON input', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OpenApiMcpError(
      'REQUEST_ERROR',
      'CLI input must be a JSON object',
    );
  }

  return parsed as Record<string, unknown>;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireConfigPath(configPath: string | undefined): string {
  if (!configPath) {
    throw new OpenApiMcpError('CONFIG_ERROR', 'Missing required --config');
  }
  return configPath;
}

function createToolCommand(toolName: string) {
  const definition = getToolDefinition(toolName);
  if (!definition) {
    throw new Error(`Missing tool definition for ${toolName}`);
  }

  return command({
    name: toolName,
    description: definition.description,
    args: {
      config: option({
        type: optional(string),
        long: 'config',
        short: 'c',
        description: 'Path to YAML configuration file',
      }),
      input: option({
        type: optional(string),
        long: 'input',
        description: 'Single JSON object with tool arguments',
      }),
      fields: multioption({
        type: array(string),
        long: 'fields',
        description:
          'Repeatable JSONPath selector for filtering success output',
      }),
      authFile: option({
        type: optional(string),
        long: 'auth-file',
        description: 'Override auth store file path',
      }),
      describe: flag({
        long: 'describe',
        description: 'Print the MCP-style tool descriptor JSON and exit',
      }),
    },
    handler: async ({ config, input, fields, authFile, describe }) => {
      if (describe) {
        printJson(definition.descriptor);
        return;
      }

      const configPath = requireConfigPath(config);
      const context = await buildContext(configPath, authFile);
      const parsedInput = parseJsonObject(input ?? '{}');
      if (fields.length > 0) {
        parsedInput.fields = fields;
      }
      printJson(await definition.execute(context, parsedInput));
    },
  });
}

const authInputSchema = z.object({
  api: z.string().min(1),
  scheme: z.string().min(1),
  token: z.string().optional(),
  authFile: z.string().optional(),
  fields: z.array(z.string()).optional(),
});

const authOutputSchema = z.object({
  stored: z.literal(true),
  kind: z.enum(['oauth2', 'apiKey', 'http-bearer']),
  apiName: z.string(),
  schemeName: z.string(),
  authFile: z.string(),
  expiresAt: z.string().optional(),
});

const authCommand = command({
  name: 'auth',
  description:
    'Authenticate one API security scheme and persist its token to the auth store.',
  args: {
    config: option({
      type: optional(string),
      long: 'config',
      short: 'c',
      description: 'Path to YAML configuration file',
    }),
    api: option({
      type: optional(string),
      long: 'api',
      description: 'Configured API name',
    }),
    scheme: option({
      type: optional(string),
      long: 'scheme',
      description: 'Security scheme name',
    }),
    token: option({
      type: optional(string),
      long: 'token',
      description: 'Manual token value for apiKey and HTTP bearer schemes',
    }),
    authFile: option({
      type: optional(string),
      long: 'auth-file',
      description: 'Override auth store file path',
    }),
    fields: multioption({
      type: array(string),
      long: 'fields',
      description: 'Repeatable JSONPath selector for filtering success output',
    }),
    describe: flag({
      long: 'describe',
      description: 'Print the command descriptor JSON and exit',
    }),
  },
  handler: async ({
    config,
    api,
    scheme,
    token,
    authFile,
    fields,
    describe,
  }) => {
    if (describe) {
      printJson({
        name: 'auth',
        description:
          'Authenticate one API security scheme and persist its token to the auth store.',
        inputSchema: toJsonSchemaCompat(authInputSchema),
        outputSchema: toJsonSchemaCompat(authOutputSchema),
      });
      return;
    }

    const configPath = requireConfigPath(config);
    if (!api || !scheme) {
      throw new OpenApiMcpError(
        'CONFIG_ERROR',
        'Missing required --api or --scheme',
      );
    }

    const context = await buildContext(configPath, authFile);
    const loadedApi = context.registry.byName.get(api.toLowerCase());
    if (!loadedApi) {
      throw new OpenApiMcpError('API_NOT_FOUND', `Unknown API '${api}'`);
    }
    const actualSchemeName =
      Object.keys(loadedApi.schema.components?.securitySchemes ?? {}).find(
        (name) => name.toLowerCase() === scheme.toLowerCase(),
      ) ?? scheme;

    const stored = await authenticateSelectedScheme({
      api: loadedApi,
      schemeName: actualSchemeName,
      oauthClient: context.oauthClient,
      env: context.env,
      token,
      onInteractive: (payload) => {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
      },
    });

    let persisted;
    if (stored.kind === 'oauth2') {
      persisted = await context.authStore?.setOAuth2Token({
        apiName: stored.apiName,
        schemeName: stored.schemeName,
        accessToken: stored.token,
        expiresAt: stored.expiresAt,
      });
    } else {
      persisted = await context.authStore?.setToken({
        apiName: stored.apiName,
        schemeName: stored.schemeName,
        kind: stored.kind,
        token: stored.token,
      });
    }

    const output = authOutputSchema.parse({
      stored: true,
      kind: stored.kind,
      apiName: stored.apiName,
      schemeName: stored.schemeName,
      authFile:
        context.authStore?.filePath ??
        resolveAuthStorePath(configPath, authFile, process.env),
      expiresAt:
        persisted && 'expiresAt' in persisted ? persisted.expiresAt : undefined,
    });

    printJson(
      applyJsonPathFields(output, fields.length > 0 ? fields : undefined),
    );
  },
});

const serveCommand = command({
  name: 'serve',
  description: 'MCP stdio server for OpenAPI APIs',
  version,
  args: {
    config: option({
      type: string,
      long: 'config',
      short: 'c',
      description: 'Path to YAML configuration file',
    }),
    authFile: option({
      type: optional(string),
      long: 'auth-file',
      description: 'Override auth store file path',
    }),
  },
  handler: ({ config, authFile }) => runServer(config, authFile),
});

const root = subcommands({
  name: 'openapi-dynamic-mcp',
  cmds: {
    serve: serveCommand,
    auth: authCommand,
    list_apis: createToolCommand('list_apis'),
    list_api_endpoints: createToolCommand('list_api_endpoints'),
    get_api_endpoint: createToolCommand('get_api_endpoint'),
    get_api_schema: createToolCommand('get_api_schema'),
    make_endpoint_request: createToolCommand('make_endpoint_request'),
  },
});

async function main(argv: string[]): Promise<void> {
  const subcommands = new Set([
    'serve',
    'auth',
    ...toolDefinitions.map((tool) => tool.name),
  ]);
  const first = argv[0];
  if (first && subcommands.has(first)) {
    await run(root, argv);
    return;
  }

  await run(serveCommand, argv);
}

main(process.argv.slice(2)).catch((error: unknown) => {
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
