import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/loadConfig.js';
import { OpenApiMcpError } from '../src/errors.js';

const fixturesDir = path.resolve('test/fixtures');

describe('loadConfig', () => {
  it('loads and resolves spec paths', async () => {
    const config = await loadConfig(path.join(fixturesDir, 'config.yaml'));

    expect(config.version).toBe(1);
    expect(config.apis).toHaveLength(2);
    expect(config.apis[0].specPath).toBe(
      path.join(fixturesDir, 'pet-api.yaml'),
    );
    expect(config.apis[0].timeoutMs).toBe(30000);
    expect(config.apis[0].retry429).toEqual({
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      jitterRatio: 0.25,
      respectRetryAfter: true,
    });
  });

  it('fails on duplicate names', async () => {
    await expect(
      loadConfig(path.join(fixturesDir, 'config-duplicate-names.yaml')),
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
    } satisfies Partial<OpenApiMcpError>);
  });

  it('fails on missing spec file', async () => {
    await expect(
      loadConfig(path.join(fixturesDir, 'config-missing-spec.yaml')),
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
    } satisfies Partial<OpenApiMcpError>);
  });

  it('fails on invalid retry429 config', async () => {
    await expect(
      loadConfig(path.join(fixturesDir, 'config-invalid-retry.yaml')),
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
    } satisfies Partial<OpenApiMcpError>);
  });

  it('fails on unreadable config files', async () => {
    await expect(
      loadConfig(path.join(fixturesDir, 'missing.yaml')),
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('Cannot read config file'),
    } satisfies Partial<OpenApiMcpError>);
  });

  it('fails on invalid yaml', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'openapi-mcp-config-'));
    const configPath = path.join(tempDir, 'invalid.yaml');

    try {
      await writeFile(
        configPath,
        'version: 1\napis:\n  - name: pet-api\n    specPath: [\n',
      );

      await expect(loadConfig(configPath)).rejects.toMatchObject({
        code: 'CONFIG_ERROR',
        message: expect.stringContaining('Invalid YAML in config'),
      } satisfies Partial<OpenApiMcpError>);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when both specPath and specUrl are provided', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'openapi-mcp-config-'));
    const configPath = path.join(tempDir, 'invalid-both.yaml');

    try {
      await writeFile(
        configPath,
        [
          'version: 1',
          'apis:',
          '  - name: pet-api',
          '    specPath: ./pet-api.yaml',
          '    specUrl: https://api.example.com/openapi.json',
        ].join('\n'),
      );

      await expect(loadConfig(configPath)).rejects.toMatchObject({
        code: 'CONFIG_ERROR',
        message: 'Config validation failed',
      } satisfies Partial<OpenApiMcpError>);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves legacy oauth2 config and per-scheme oauth2 config', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'openapi-mcp-config-'));
    const specPath = path.join(fixturesDir, 'pet-api.yaml');
    const legacyConfigPath = path.join(tempDir, 'legacy.yaml');
    const schemeConfigPath = path.join(tempDir, 'schemes.yaml');

    try {
      await writeFile(
        legacyConfigPath,
        [
          'version: 1',
          'apis:',
          '  - name: pet-api',
          `    specPath: ${JSON.stringify(specPath)}`,
          '    oauth2:',
          '      tokenUrlOverride: https://auth.example.com/legacy-token',
          '      scopes: [read:pets]',
          '      tokenEndpointAuthMethod: client_secret_post',
        ].join('\n'),
      );

      await writeFile(
        schemeConfigPath,
        [
          'version: 1',
          'apis:',
          '  - name: pet-api',
          `    specPath: ${JSON.stringify(specPath)}`,
          '    oauth2:',
          '      OAuthCC:',
          '        tokenUrl: https://auth.example.com/scheme-token',
          '        scopes: [read:pets, write:pets]',
          '        tokenEndpointAuthMethod: client_secret_basic',
          '        authMethod: device_code',
        ].join('\n'),
      );

      const legacy = await loadConfig(legacyConfigPath);
      const perScheme = await loadConfig(schemeConfigPath);

      expect(legacy.apis[0]?.oauth2).toEqual({
        tokenUrlOverride: 'https://auth.example.com/legacy-token',
        scopes: ['read:pets'],
        tokenEndpointAuthMethod: 'client_secret_post',
      });
      expect(legacy.apis[0]?.oauth2Schemes).toBeUndefined();

      expect(perScheme.apis[0]?.oauth2).toBeUndefined();
      expect(perScheme.apis[0]?.oauth2Schemes).toEqual({
        OAuthCC: {
          tokenUrl: 'https://auth.example.com/scheme-token',
          scopes: ['read:pets', 'write:pets'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          authMethod: 'device_code',
        },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
