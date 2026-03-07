import type { ApiRegistry } from '../types.js';
import { OAuthClient } from '../auth/oauthClient.js';
import type { AuthStore } from '../auth/authStore.js';

export interface ToolContext {
  registry: ApiRegistry;
  oauthClient: OAuthClient;
  authStore?: AuthStore;
  env: NodeJS.ProcessEnv;
}
