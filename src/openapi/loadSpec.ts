import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
import * as swagger2openapi from 'swagger2openapi';
import type { OpenAPIV3 } from 'openapi-types';
import { parse as parseYaml } from 'yaml';
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
  const schemaBaseUrl = resolveSchemaBaseUrl(document);
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

function resolveSchemaBaseUrl(
  document: OpenAPIV3.Document,
): string | undefined {
  const resolvedServers =
    document.servers?.map(resolveServerUrl).filter(Boolean) ?? [];

  return (
    resolvedServers.find((url) => isAbsoluteUrl(url as string)) ??
    resolvedServers[0]
  );
}

function resolveServerUrl(
  server: OpenAPIV3.ServerObject | undefined,
): string | undefined {
  if (!server?.url) {
    return undefined;
  }

  return server.url.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const variable = server.variables?.[name];
    return variable?.default ?? `{${name}}`;
  });
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function loadRawSpec(specSource: string): Promise<unknown> {
  if (specSource.startsWith('http://') || specSource.startsWith('https://')) {
    const response = await fetch(specSource);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} when loading schema`);
    }
    const raw = await response.text();
    return parseSpecText(raw);
  }

  return parseSpecText(await readFile(specSource, 'utf8'));
}

function parseSpecText(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return parseYaml(raw);
  }
}

async function dereferenceDocument(
  source: string | OpenAPIV3.Document,
): Promise<OpenAPIV3.Document> {
  return (await SwaggerParser.dereference(source)) as OpenAPIV3.Document;
}

async function loadSingleApi(
  api: ApiConfig,
  env: NodeJS.ProcessEnv,
): Promise<LoadedApi> {
  const specSource = api.specUrl ?? api.specPath;
  if (!specSource) {
    throw new OpenApiMcpError(
      'CONFIG_ERROR',
      `No spec path or URL provided for API '${api.name}'`,
    );
  }

  let parsed: unknown;
  try {
    const rawSpec = await loadRawSpec(specSource);
    if (
      rawSpec &&
      typeof rawSpec === 'object' &&
      'swagger' in rawSpec &&
      (rawSpec as Record<string, unknown>).swagger === '2.0'
    ) {
      try {
        // Parse YAML/JSON first so swagger2openapi can handle merge keys before dereference.
        const converted = await swagger2openapi.convertObj(rawSpec, {
          patch: true,
          warnOnly: true,
        });
        parsed = await dereferenceDocument(converted.openapi);
      } catch (error) {
        throw new OpenApiMcpError(
          'SCHEMA_ERROR',
          `Failed to convert Swagger 2.0 to OpenAPI 3.0 for '${api.name}'`,
          {
            apiName: api.name,
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }
    } else {
      parsed = await dereferenceDocument(specSource);
    }
  } catch (error) {
    if (error instanceof OpenApiMcpError) {
      throw error;
    }
    const cause = error instanceof Error ? error.message : String(error);
    const isUrl =
      specSource.startsWith('http://') || specSource.startsWith('https://');

    if (isUrl) {
      const msg = cause.toLowerCase();
      if (
        msg.includes('enotfound') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('fetch failed')
      ) {
        throw new OpenApiMcpError(
          'SCHEMA_ERROR',
          `URL unreachable for '${api.name}': ${specSource}`,
          { apiName: api.name, specSource, cause },
        );
      }
      if (
        msg.includes('not a valid json schema') ||
        msg.includes('not a valid swagger') ||
        msg.includes('not a valid openapi')
      ) {
        throw new OpenApiMcpError(
          'SCHEMA_ERROR',
          `Not a valid OpenAPI spec for '${api.name}': ${specSource}`,
          { apiName: api.name, specSource, cause },
        );
      }
    }

    throw new OpenApiMcpError(
      'SCHEMA_ERROR',
      `Failed to parse OpenAPI schema for '${api.name}'`,
      {
        apiName: api.name,
        specSource,
        cause,
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
    schemaPath: specSource,
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
