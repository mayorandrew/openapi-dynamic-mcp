import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3 } from 'openapi-types';
import { readApiBaseUrl } from '../auth/env.js';
import { OpenApiMcpError } from '../errors.js';
import type {
  ApiConfig,
  ApiRegistry,
  LoadedApi,
  RootConfig,
} from '../types.js';
import { buildEndpointIndex } from './endpointIndex.js';

function assertSupportedOpenApiVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) {
    throw new OpenApiMcpError(
      'SCHEMA_ERROR',
      `Unsupported OpenAPI version format: ${version}`,
    );
  }

  const major = Number(match[1]);

  if (major < 3) {
    throw new OpenApiMcpError(
      'SCHEMA_ERROR',
      `OpenAPI version must be 3.x (received ${version})`,
    );
  }
}

function resolveBaseUrl(
  api: ApiConfig,
  document: OpenAPIV3.Document,
  env: NodeJS.ProcessEnv,
): string {
  const envBaseUrl = readApiBaseUrl(api.name, env);
  const schemaBaseUrl = document.servers?.[0]?.url;
  const baseUrl = envBaseUrl ?? api.baseUrl ?? schemaBaseUrl;
  if (!baseUrl) {
    throw new OpenApiMcpError(
      'CONFIG_ERROR',
      `No base URL found for API '${api.name}'`,
      {
        resolutionOrder: [
          'env:<API>_BASE_URL',
          'config.baseUrl',
          'openapi.servers[0].url',
        ],
      },
    );
  }
  return baseUrl;
}

async function loadSingleApi(
  api: ApiConfig,
  env: NodeJS.ProcessEnv,
): Promise<LoadedApi> {
  let parsed: unknown;
  try {
    parsed = await SwaggerParser.dereference(api.specPath);
  } catch (error) {
    throw new OpenApiMcpError(
      'SCHEMA_ERROR',
      `Failed to parse OpenAPI schema for '${api.name}'`,
      {
        apiName: api.name,
        specPath: api.specPath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const document = parsed as OpenAPIV3.Document;
  if (!document || typeof document !== 'object') {
    throw new OpenApiMcpError(
      'SCHEMA_ERROR',
      `Invalid OpenAPI document for '${api.name}'`,
    );
  }

  if (!document.openapi) {
    throw new OpenApiMcpError(
      'SCHEMA_ERROR',
      `OpenAPI 'openapi' field is missing in '${api.name}'`,
    );
  }

  assertSupportedOpenApiVersion(document.openapi);

  const { endpoints, endpointById } = buildEndpointIndex(document);
  const baseUrl = resolveBaseUrl(api, document, env);
  const authSchemeNames = Object.keys(
    document.components?.securitySchemes ?? {},
  );

  return {
    config: api,
    schemaPath: api.specPath,
    schema: document,
    baseUrl,
    endpoints,
    endpointById,
    authSchemeNames,
  };
}

export async function loadApiRegistry(
  config: RootConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApiRegistry> {
  const byName = new Map<string, LoadedApi>();

  for (const api of config.apis) {
    const loadedApi = await loadSingleApi(api, env);
    byName.set(api.name.toLowerCase(), loadedApi);
  }

  return { byName };
}
