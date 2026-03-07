import path from 'node:path';
import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { OAuthClient } from '../src/auth/oauthClient.js';
import {
  executeEndpointRequest,
  prepareEndpointRequest,
} from '../src/http/requestExecutor.js';
import { loadApiRegistry } from '../src/openapi/loadSpec.js';
import type {
  EndpointDefinition,
  LoadedApi,
  RootConfig,
} from '../src/types.js';

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

  it('respects HTTP-date Retry-After when present', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;
    const retryAfterDate = new Date(Date.now() + 2000).toUTCString();

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(
        429,
        { error: 'rate_limited' },
        { 'content-type': 'application/json', 'retry-after': retryAfterDate },
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
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
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

  it('processes application/x-www-form-urlencoded payloads', async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('uploadFormUrlEncoded')!;

    const scope = nock('https://api.example.com')
      .post('/v1/upload-form', 'name=fido&tags=good&tags=boy')
      .reply(200, { ok: true }, { 'content-type': 'application/json' });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env: { PET_API_APIKEYAUTH_API_KEY: 'api-secret' },
      contentType: 'application/x-www-form-urlencoded',
      body: {
        name: 'fido',
        tags: ['good', 'boy'],
      },
    });

    expect(result.response.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  it('processes multipart/form-data with file descriptors', async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('uploadMultipart')!;

    // We don't verify the exact nock body for multipart because
    // fetch will automatically generate a dynamic multipart boundary
    const scope = nock('https://api.example.com')
      .post('/v1/upload-multipart')
      .reply(200, { ok: true }, { 'content-type': 'application/json' });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env: { PET_API_APIKEYAUTH_API_KEY: 'api-secret' },
      contentType: 'multipart/form-data',
      body: {
        description: 'a test file',
      },
      files: {
        file: {
          name: 'test.txt',
          text: 'hello world',
          contentType: 'text/plain',
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  it('returns text for Content-Type: text/xml', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(200, '<xml>data</xml>', { 'content-type': 'text/xml' });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(result.response.bodyType).toBe('text');
    expect(result.response.bodyText).toBe('<xml>data</xml>');
  });

  it('returns text for Content-Type: application/xml', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(200, '<xml>data</xml>', {
        'content-type': 'application/xml',
      });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(result.response.bodyType).toBe('text');
  });

  it('returns empty for Content-Type: application/octet-stream with no data', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(200, Buffer.alloc(0), {
        'content-type': 'application/octet-stream',
      });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(result.response.bodyType).toBe('empty');
  });

  it('returns text for Content-Type with charset parameter', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(200, 'plain text', {
        'content-type': 'text/plain; charset=utf-8',
      });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(result.response.bodyType).toBe('text');
    expect(result.response.bodyText).toBe('plain text');
  });

  it('processes raw binary data with base64 descriptor', async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('uploadRaw')!;

    const scope = nock('https://api.example.com')
      .put('/v1/upload-raw', Buffer.from('binary-data', 'utf8'))
      .reply(200, { ok: true }, { 'content-type': 'application/json' });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env: { PET_API_APIKEYAUTH_API_KEY: 'api-secret' },
      contentType: 'application/octet-stream',
      files: {
        body: {
          base64: Buffer.from('binary-data', 'utf8').toString('base64'),
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(scope.isDone()).toBe(true);
  });

  it('returns empty for 204 and 205 responses', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(204)
      .get('/v1/pets')
      .query(true)
      .reply(205);

    const first = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });
    const second = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(first.response.bodyType).toBe('empty');
    expect(second.response.bodyType).toBe('empty');
  });

  it('falls back to text when json content is invalid', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;

    nock('https://api.example.com')
      .get('/v1/pets')
      .query(true)
      .reply(200, '{not-json}', { 'content-type': 'application/json' });

    const result = await executeEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
    });

    expect(result.response.bodyType).toBe('text');
    expect(result.response.bodyText).toBe('{not-json}');
  });

  it('serializes deepObject query parameters', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = buildEndpoint(api, {
      endpointId: 'searchDeepObject',
      path: '/search',
      method: 'get',
      operation: {
        responses: { '200': { description: 'ok' } },
        parameters: [
          {
            name: 'filter',
            in: 'query',
            style: 'deepObject',
            explode: true,
            schema: { type: 'object' },
          },
        ],
      },
    });

    const prepared = await prepareEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      query: {
        filter: {
          status: 'open',
          owner: 'alice',
        },
      },
    });

    expect('fetchUrl' in prepared).toBe(true);
    if ('fetchUrl' in prepared) {
      expect(prepared.fetchUrl.searchParams.get('filter[status]')).toBe('open');
      expect(prepared.fetchUrl.searchParams.get('filter[owner]')).toBe('alice');
    }
  });

  it('serializes non-exploded arrays and objects in query parameters', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = buildEndpoint(api, {
      endpointId: 'searchFormStyle',
      path: '/search',
      method: 'get',
      operation: {
        responses: { '200': { description: 'ok' } },
        parameters: [
          {
            name: 'tags',
            in: 'query',
            style: 'form',
            explode: false,
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'filter',
            in: 'query',
            style: 'form',
            explode: false,
            schema: { type: 'object' },
          },
        ],
      },
    });

    const prepared = await prepareEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      query: {
        tags: ['one', 'two'],
        filter: { status: 'open', owner: 'alice' },
      },
    });

    expect('fetchUrl' in prepared).toBe(true);
    if ('fetchUrl' in prepared) {
      expect(prepared.fetchUrl.searchParams.get('tags')).toBe('one,two');
      expect(prepared.fetchUrl.searchParams.get('filter')).toBe(
        'status,open,owner,alice',
      );
    }
  });

  it('expands array and object path parameters', async () => {
    const env: NodeJS.ProcessEnv = {
      PET_API_APIKEYAUTH_API_KEY: 'api-secret',
    };
    const registry = await loadApiRegistry(buildConfig(), env);
    const api = registry.byName.get('pet-api')!;
    const endpoint = buildEndpoint(api, {
      endpointId: 'pathExpansion',
      path: '/items/{ids}/{filter}',
      method: 'get',
      operation: {
        responses: { '200': { description: 'ok' } },
        parameters: [
          {
            name: 'ids',
            in: 'path',
            required: true,
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'filter',
            in: 'path',
            required: true,
            schema: { type: 'object' },
          },
        ],
      },
    });

    const prepared = await prepareEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      pathParams: {
        ids: ['a', 'b'],
        filter: { status: 'open', owner: 'alice' },
      },
    });

    expect('fetchUrl' in prepared).toBe(true);
    if ('fetchUrl' in prepared) {
      expect(prepared.fetchUrl.toString()).toContain(
        '/items/a,b/status%2Copen%2Cowner%2Calice',
      );
    }
  });

  it('applies cookie auth and redacts cookies and auth headers', async () => {
    const api = buildCookieAuthApi();
    const endpoint = api.endpointById.get('cookieEndpoint')!;

    const prepared = await prepareEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env: {
        COOKIE_API_COOKIEAUTH_API_KEY: 'cookie-secret',
      },
      cookies: {
        session: 'user-cookie',
      },
      headers: {
        Authorization: 'Bearer explicit',
      },
    });

    expect('fetchHeaders' in prepared).toBe(true);
    if ('fetchHeaders' in prepared) {
      expect(prepared.fetchHeaders.cookie).toContain('session=user-cookie');
      expect(prepared.fetchHeaders.cookie).toContain(
        'cookie_key=cookie-secret',
      );
      expect(prepared.request.headersRedacted.cookie).toBe('<redacted>');
      expect(prepared.request.headersRedacted.Authorization).toBe('<redacted>');
    }
  });

  it('rejects multiple files for raw binary bodies', async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('uploadRaw')!;

    await expect(
      prepareEndpointRequest({
        api,
        endpoint,
        oauthClient: new OAuthClient(),
        env: { PET_API_APIKEYAUTH_API_KEY: 'api-secret' },
        files: {
          one: { text: 'one' },
          two: { text: 'two' },
        },
      }),
    ).rejects.toMatchObject({
      code: 'REQUEST_ERROR',
      message: 'Multiple files provided but expected a single raw binary body',
    });
  });

  it('rejects invalid file descriptors', async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('uploadRaw')!;

    await expect(
      prepareEndpointRequest({
        api,
        endpoint,
        oauthClient: new OAuthClient(),
        env: { PET_API_APIKEYAUTH_API_KEY: 'api-secret' },
        // Intentionally bypass the descriptor type to cover runtime validation.
        files: { body: {} as never },
      }),
    ).rejects.toMatchObject({
      code: 'REQUEST_ERROR',
      message: 'File descriptor must have base64, text, or filePath',
    });
  });

  it('previews text and json request bodies with inferred content types', async () => {
    const registry = await loadApiRegistry(buildConfig(), {});
    const api = registry.byName.get('pet-api')!;
    const endpoint = api.endpointById.get('listPets')!;
    const env = { PET_API_APIKEYAUTH_API_KEY: 'api-secret' };

    const textPrepared = await prepareEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      body: 'plain text body',
    });
    const jsonPrepared = await prepareEndpointRequest({
      api,
      endpoint,
      oauthClient: new OAuthClient(),
      env,
      body: { hello: 'world' },
    });

    expect('fetchHeaders' in textPrepared).toBe(true);
    if ('fetchHeaders' in textPrepared) {
      expect(textPrepared.fetchHeaders['content-type']).toBe('text/plain');
      expect(textPrepared.requestBodyPreview).toEqual({
        bodyType: 'text',
        bodyText: 'plain text body',
      });
    }

    expect('fetchHeaders' in jsonPrepared).toBe(true);
    if ('fetchHeaders' in jsonPrepared) {
      expect(jsonPrepared.fetchHeaders['content-type']).toBe(
        'application/json',
      );
      expect(jsonPrepared.requestBodyPreview).toEqual({
        bodyType: 'json',
        bodyJson: { hello: 'world' },
      });
    }
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

function buildEndpoint(
  api: LoadedApi,
  input: {
    endpointId: string;
    path: string;
    method: EndpointDefinition['method'];
    operation: EndpointDefinition['operation'];
  },
): EndpointDefinition {
  return {
    endpointId: input.endpointId,
    path: input.path,
    method: input.method,
    operationId: input.endpointId,
    operation: input.operation,
    pathItem: {
      [input.method]: input.operation,
    },
  };
}

function buildCookieAuthApi(): LoadedApi {
  const endpoint = buildEndpoint(
    {
      config: { name: 'cookie-api', baseUrl: 'https://cookie.example.com' },
      schemaPath: 'inline',
      schema: {
        openapi: '3.0.3',
        info: { title: 'cookie-api', version: '1.0.0' },
        paths: {},
        components: {
          securitySchemes: {
            CookieAuth: {
              type: 'apiKey',
              in: 'cookie',
              name: 'cookie_key',
            },
          },
        },
      },
      baseUrl: 'https://cookie.example.com',
      endpoints: [],
      endpointById: new Map(),
      authSchemeNames: ['CookieAuth'],
    },
    {
      endpointId: 'cookieEndpoint',
      path: '/cookie',
      method: 'get',
      operation: {
        security: [{ CookieAuth: [] }],
        responses: { '200': { description: 'ok' } },
      },
    },
  );

  return {
    config: { name: 'cookie-api', baseUrl: 'https://cookie.example.com' },
    schemaPath: 'inline',
    schema: {
      openapi: '3.0.3',
      info: { title: 'cookie-api', version: '1.0.0' },
      paths: {},
      components: {
        securitySchemes: {
          CookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'cookie_key',
          },
        },
      },
    },
    baseUrl: 'https://cookie.example.com',
    endpoints: [endpoint],
    endpointById: new Map([[endpoint.endpointId, endpoint]]),
    authSchemeNames: ['CookieAuth'],
  };
}
