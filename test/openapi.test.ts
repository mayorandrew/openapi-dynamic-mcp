import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadApiRegistry } from '../src/openapi/loadSpec.js';
import type { RootConfig } from '../src/types.js';
import { OpenApiMcpError } from '../src/errors.js';

const fixturesDir = path.resolve('test/fixtures');

describe('OpenAPI loading/index', () => {
  it('loads schema and indexes endpoints', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'pet-api',
          specPath: path.join(fixturesDir, 'pet-api.yaml'),
        },
      ],
    };

    const registry = await loadApiRegistry(config, {});
    const api = registry.byName.get('pet-api');
    expect(api).toBeDefined();
    expect(api?.endpoints.length).toBe(7);
    expect(api?.endpointById.has('listPets')).toBe(true);
    expect(api?.baseUrl).toBe('https://api.example.com/v1');
  });

  it('falls back to METHOD path id when operationId duplicates', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'dup-api',
          specPath: path.join(fixturesDir, 'duplicate-opid.yaml'),
        },
      ],
    };

    const registry = await loadApiRegistry(config, {});
    const api = registry.byName.get('dup-api');

    expect(api?.endpointById.has('GET /a')).toBe(true);
    expect(api?.endpointById.has('GET /b')).toBe(true);
  });

  it('accepts and converts Swagger 2.0', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'old-api',
          specPath: path.join(fixturesDir, 'openapi-2.0.yaml'),
        },
      ],
    };

    const registry = await loadApiRegistry(config, {});
    const api = registry.byName.get('old-api');

    expect(api).toBeDefined();
    expect(api?.endpoints.length).toBeGreaterThan(0);
    expect(api?.schema.openapi.startsWith('3.0')).toBe(true);
  });
  it('throws on unsupported OpenAPI version', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'bad-version',
          specPath: path.join(fixturesDir, 'invalid-version.yaml'),
        },
      ],
    };
    await expect(loadApiRegistry(config, {})).rejects.toThrowError(
      OpenApiMcpError,
    );
  });

  it('throws on missing both specPath and specUrl', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'missing-path',
        } as any,
      ],
    };
    await expect(loadApiRegistry(config, {})).rejects.toThrowError(
      OpenApiMcpError,
    );
  });

  it('throws on malformed spec missing openapi version', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'missing-openapi-field',
          specPath: path.join(fixturesDir, 'does-not-exist.yaml'),
        },
      ],
    };
    await expect(loadApiRegistry(config, {})).rejects.toThrowError(
      OpenApiMcpError,
    );
  });
});
