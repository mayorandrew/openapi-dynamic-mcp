import type { ApiRegistry } from '../types.js';
import { OAuthClient } from '../auth/oauthClient.js';

export interface ToolContext {
  registry: ApiRegistry;
  oauthClient: OAuthClient;
  env: NodeJS.ProcessEnv;
}
