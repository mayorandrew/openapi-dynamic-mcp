import path from 'node:path';
import { OAuthClient } from '../../src/auth/oauthClient.js';
import { loadApiRegistry } from '../../src/openapi/loadSpec.js';
import type { RootConfig } from '../../src/types.js';
import type { ToolContext } from '../../src/mcp/context.js';
export const fixturesDir = path.resolve('test/public-apis/fixtures');
export async function createTestContext(
  apiName: string,
  specFileName: string,
): Promise<ToolContext> {
  const env: NodeJS.ProcessEnv = {};
  const config: RootConfig = {
    version: 1,
    apis: [
      {
        name: apiName,
        specPath: path.join(fixturesDir, specFileName),
      },
    ],
  };
  const registry = await loadApiRegistry(config, env);

  // Provide dummy credentials for all security schemes to prevent AUTH_ERROR
  const loadedApi = registry.byName.get(apiName.toLowerCase());
  if (loadedApi) {
    for (const schemeName of loadedApi.authSchemeNames) {
      const prefix = `${apiName}_${schemeName}`
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_');
      env[`${prefix}_API_KEY`] = 'dummy_key';
      env[`${prefix}_TOKEN`] = 'dummy_token';
      env[`${prefix}_USERNAME`] = 'dummy_user';
      env[`${prefix}_PASSWORD`] = 'dummy_pass';
      env[`${prefix}_CLIENT_ID`] = 'dummy_client';
      env[`${prefix}_CLIENT_SECRET`] = 'dummy_secret';
    }
  }

  return {
    registry,
    oauthClient: new OAuthClient(),
    env,
  };
}
