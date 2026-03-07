import path from 'node:path';
import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { loadApiRegistry } from '../src/openapi/loadSpec.js';
import type { RootConfig } from '../src/types.js';
import { OpenApiMcpError } from '../src/errors.js';

afterEach(() => {
  nock.cleanAll();
});

const fixturesDir = path.resolve('test/fixtures');
const publicFixturesDir = path.resolve('test/public-apis/fixtures');

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
    expect(api?.endpoints.length).toBe(9);
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

  it('converts Swagger 2.0 specs that use YAML merge keys', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'launchdarkly',
          specPath: path.join(publicFixturesDir, 'launchdarkly.yaml'),
        },
      ],
    };

    const registry = await loadApiRegistry(config, {});
    const api = registry.byName.get('launchdarkly');

    expect(api).toBeDefined();
    expect(api?.schema.openapi.startsWith('3.0')).toBe(true);
    expect(api?.endpoints.length).toBeGreaterThan(0);
  });

  it('prefers an absolute server URL when the first server is relative', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'docker-engine',
          specPath: path.join(publicFixturesDir, 'docker-engine.yaml'),
        },
      ],
    };

    const registry = await loadApiRegistry(config, {});
    const api = registry.byName.get('docker-engine');

    expect(api).toBeDefined();
    expect(api?.baseUrl).toBe('https://docker.com/1.33');
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

  it('loads OpenAPI 3.1 spec with 3.1-specific features', async () => {
    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'api31',
          specPath: path.join(fixturesDir, 'openapi-3.1.yaml'),
        },
      ],
    };

    const registry = await loadApiRegistry(config, {});
    const api = registry.byName.get('api31');
    expect(api).toBeDefined();
    expect(api?.schema.openapi).toBe('3.1.0');
    expect(api?.endpoints.length).toBe(2);
    expect(api?.endpointById.has('listItems')).toBe(true);
    expect(api?.endpointById.has('getItem')).toBe(true);
    expect(api?.baseUrl).toBe('https://api31.example.com');
  });

  it('gives friendly error for unreachable specUrl', async () => {
    nock('https://unreachable.example.com')
      .get('/spec.yaml')
      .replyWithError('getaddrinfo ENOTFOUND unreachable.example.com');

    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'remote-api',
          specUrl: 'https://unreachable.example.com/spec.yaml',
        },
      ],
    };
    await expect(loadApiRegistry(config, {})).rejects.toMatchObject({
      code: 'SCHEMA_ERROR',
      message: expect.stringContaining('URL unreachable'),
    });
  });

  it('gives friendly error for non-OpenAPI response from specUrl', async () => {
    nock('https://bad-spec.example.com')
      .get('/spec.yaml')
      .reply(200, '<html>Not a spec</html>', {
        'content-type': 'text/html',
      });

    const config: RootConfig = {
      version: 1,
      apis: [
        {
          name: 'bad-spec-api',
          specUrl: 'https://bad-spec.example.com/spec.yaml',
        },
      ],
    };
    await expect(loadApiRegistry(config, {})).rejects.toMatchObject({
      code: 'SCHEMA_ERROR',
    });
  });
});
