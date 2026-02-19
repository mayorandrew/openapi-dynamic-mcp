import path from 'node:path';
import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { OAuthClient } from '../src/auth/oauthClient.js';
import { executeEndpointRequest } from '../src/http/requestExecutor.js';
import { loadApiRegistry } from '../src/openapi/loadSpec.js';
import type { RootConfig } from '../src/types.js';

const fixturesDir = path.resolve('test/fixtures');

afterEach(() => {
  nock.abortPendingRequests();
  nock.cleanAll();
});

describe('executeEndpointRequest', () => {
  it('merges headers and returns JSON response', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_BASE_URL: 'https://override.example.com/api',
      PET_API_HEADERS: '{"X-Env":"from-env"}',
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };

    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://override.example.com')
      .get('/api/pets')
      .query({ limit: '10' })
      .matchHeader('X-Static', 'from-config')
      .matchHeader('X-Env', 'from-env')
      .matchHeader('X-Req', 'from-request')
      .matchHeader('X-API-Key', 'api-secret')
      .reply(
        200,
        { items: [{ id: 1 }] },
        { 'content-type': 'application/json' },
      );

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      query: { limit: 10 },
      headers: { 'X-Req': 'from-request' },
    });

    expect(result.response.status).toBe(200);
    expect(result.response.bodyType).toBe('json');
    expect(result.response.bodyJson).toEqual({ items: [{ id: 1 }] });
    expect(result.request.headersRedacted['X-API-Key']).toBe('<redacted>');
  });

  it('returns binary fallback for non-text content', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(200, Buffer.from([1, 2, 3, 4]), {
        'content-type': 'application/octet-stream',
      });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(result.response.bodyType).toBe('binary');
    expect(result.response.bodyBase64).toBe(
      Buffer.from([1, 2, 3, 4]).toString('base64'),
    );
  });

  it('supports timeout', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .delay(250)
      .reply(200, { ok: true }, { 'content-type': 'application/json' });

    await expect(
      executeEndpointRequest({
        api,
        endpoint,
        oauthClient: new OAuthClient(),
        env,
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_ERROR' });
  });

  it('does not retry 429 by default', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(
        429,
        { error: 'rate_limited' },
        { 'content-type': 'application/json' },
      );

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(result.response.status).toBe(429);
  });

  it('retries 429 and eventually succeeds', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    const scope = nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(
        429,
        { error: 'rate_limited' },
        { 'content-type': 'application/json' },
      )
      .get('/v1/pets')
      .query(true)
      .reply(
        429,
        { error: 'rate_limited' },
        { 'content-type': 'application/json' },
      )
      .get('/v1/pets')
      .query(true)
      .reply(200, { ok: true }, { 'content-type': 'application/json' });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      retry429: {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 5,
        jitterRatio: 0,
      },
    });

    expect(result.response.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  it('returns 429 after exhausting retries', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    const scope = nock('https://api.example.com')
      .get('/v1/pets')
      .times(3)
      .query(true)
      .reply(
        429,
        { error: 'rate_limited' },
        { 'content-type': 'application/json' },
      );

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      retry429: {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        jitterRatio: 0,
      },
    });

    expect(result.response.status).toBe(429);
    expect(scope.isDone()).toBe(true);
  });

  it('respects Retry-After when present', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(
        429,
        { error: 'rate_limited' },
        { 'content-type': 'application/json', 'retry-after': '1' },
      )
      .get('/v1/pets')
      .query(true)
      .reply(200, { ok: true }, { 'content-type': 'application/json' });

    const startedAt = Date.now();
    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      retry429: {
        maxRetries: 1,
        baseDelayMs: 1,
        maxDelayMs: 2000,
        jitterRatio: 0,
      },
    });

    expect(result.response.status).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  }, 10000);

  it('falls back to exponential backoff on invalid Retry-After', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    const scope = nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(
        429,
        { error: 'rate_limited' },
        { 'content-type': 'application/json', 'retry-after': 'invalid' },
      )
      .get('/v1/pets')
      .query(true)
      .reply(200, { ok: true }, { 'content-type': 'application/json' });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      retry429: {
        maxRetries: 1,
        baseDelayMs: 1,
        maxDelayMs: 10,
        jitterRatio: 0,
      },
    });

    expect(result.response.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });
});

function buildConfig(): RootConfig {
  return {
    version: 1,
    apis: [
      {
        name: 'pet-api',
        specPath: path.join(fixturesDir, 'pet-api.yaml'),
        headers: {
          'X-Static': 'from-config',
        },
      },
    ],
  };
}
