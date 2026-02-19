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
});
