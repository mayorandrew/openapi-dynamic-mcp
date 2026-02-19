import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadApiRegistry } from '../src/openapi/loadSpec.js';
import type { RootConfig } from '../src/types.js';

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

  it('rejects OpenAPI 2.0', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'old-api',
          specPath: path.join(fixturesDir, 'openapi-2.0.yaml'),
        },
      ],
    };

    await expect(loadApiRegistry(config, {})).rejects.toMatchObject({
      code: 'SCHEMA_ERROR',
    });
  });
});
