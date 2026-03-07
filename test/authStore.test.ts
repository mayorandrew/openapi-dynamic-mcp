import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AUTH_STORE_ENV_VAR,
  AuthStore,
  resolveAuthStorePath,
} from '../src/auth/authStore.js';

describe('auth store', () => {
  it('prefers explicit path, then env var, then config-dir default', () => {
    expect(
      resolveAuthStorePath('/tmp/config.yaml', '/tmp/explicit.json', {}),
    ).toBe(path.resolve('/tmp/explicit.json'));
    expect(
      resolveAuthStorePath('/tmp/config.yaml', undefined, {
        [AUTH_STORE_ENV_VAR]: '/tmp/from-env.json',
      }),
    ).toBe(path.resolve('/tmp/from-env.json'));
    expect(resolveAuthStorePath('/tmp/config.yaml', undefined, {})).toBe(
      path.resolve('/tmp/.openapi-dynamic-mcp-auth.json'),
    );
  });

  it('round-trips stored tokens and ignores expired oauth tokens', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openapi-mcp-auth-'));
    const store = new AuthStore(path.join(dir, 'auth.json'));

    await store.setToken({
      apiName: 'pet-api',
      schemeName: 'ApiKeyAuth',
      kind: 'apiKey',
      token: 'secret',
    });
    expect(await store.getToken('pet-api', 'ApiKeyAuth')).toEqual({
      kind: 'apiKey',
      token: 'secret',
    });

    await store.setOAuth2Token({
      apiName: 'pet-api',
      schemeName: 'OAuthCC',
      accessToken: 'fresh-token',
      expiresAt: Date.now() + 60_000,
    });
    expect(await store.getToken('pet-api', 'OAuthCC')).toMatchObject({
      kind: 'oauth2',
      token: 'fresh-token',
    });

    await store.setOAuth2Token({
      apiName: 'pet-api',
      schemeName: 'OAuthExpired',
      accessToken: 'expired-token',
      expiresAt: Date.now() - 60_000,
    });
    expect(await store.getToken('pet-api', 'OAuthExpired')).toBeUndefined();
  });
});
