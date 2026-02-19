import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { normalizeEnvSegment } from '../auth/env.js';
import { OpenApiMcpError } from '../errors.js';
import type { ApiConfig, RootConfig } from '../types.js';

const retry429Schema = z.object({
  maxRetries: z.number().int().min(0).optional(),
  baseDelayMs: z.number().int().positive().optional(),
  maxDelayMs: z.number().int().positive().optional(),
  jitterRatio: z.number().min(0).max(1).optional(),
  respectRetryAfter: z.boolean().optional(),
});

const apiSchema = z
  .object({
    name: z.string().min(1),
    specPath: z.string().min(1).optional(),
    specUrl: z.string().url().optional(),
    baseUrl: z.string().url().optional(),
    timeoutMs: z.number().int().positive().optional(),
    headers: z.record(z.string()).optional(),
    oauth2: z
      .object({
        tokenUrlOverride: z.string().url().optional(),
        scopes: z.array(z.string().min(1)).optional(),
        tokenEndpointAuthMethod: z
          .enum(['client_secret_basic', 'client_secret_post'])
          .optional(),
      })
      .optional(),
    retry429: retry429Schema.optional(),
  })
  .refine(
    (data) =>
      (data.specPath !== undefined && data.specUrl === undefined) ||
      (data.specPath === undefined && data.specUrl !== undefined),
    { message: 'Exactly one of specPath or specUrl must be provided' },
  );

const rootSchema = z.object({
  version: z.literal(1),
  apis: z.array(apiSchema).min(1),
});

export async function loadConfig(configPath: string): Promise<RootConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new OpenApiMcpError(
      'CONFIG_ERROR',
      `Cannot read config file: ${configPath}`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(raw);
  } catch (error) {
    throw new OpenApiMcpError(
      'CONFIG_ERROR',
      `Invalid YAML in config: ${configPath}`,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const parsed = rootSchema.safeParse(parsedYaml);
  if (!parsed.success) {
    throw new OpenApiMcpError('CONFIG_ERROR', 'Config validation failed', {
      issues: parsed.error.issues,
    });
  }

  const resolvedApis: ApiConfig[] = [];
  const seenNames = new Set<string>();
  const configDir = path.dirname(path.resolve(configPath));

  for (const api of parsed.data.apis) {
    const normalized = normalizeEnvSegment(api.name).toLowerCase();
    if (seenNames.has(normalized)) {
      throw new OpenApiMcpError(
        'CONFIG_ERROR',
        `Duplicate API name: ${api.name}`,
      );
    }
    seenNames.add(normalized);

    if (api.specPath !== undefined) {
      const resolvedSpecPath = path.resolve(configDir, api.specPath);
      try {
        await access(resolvedSpecPath);
      } catch {
        throw new OpenApiMcpError(
          'CONFIG_ERROR',
          `OpenAPI schema file not found: ${resolvedSpecPath}`,
          {
            apiName: api.name,
          },
        );
      }

      resolvedApis.push({
        ...api,
        specPath: resolvedSpecPath,
        timeoutMs: api.timeoutMs ?? 30000,
      });
    } else {
      resolvedApis.push({
        ...api,
        timeoutMs: api.timeoutMs ?? 30000,
      });
    }
  }

  return {
    version: 1,
    apis: resolvedApis,
  };
}
