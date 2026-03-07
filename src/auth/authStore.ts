import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { apiPrefix, schemePrefix } from './env.js';
import { OpenApiMcpError } from '../errors.js';

export const AUTH_STORE_ENV_VAR = 'OPENAPI_DYNAMIC_MCP_AUTH_FILE';
const AUTH_STORE_VERSION = 1;

interface AuthStoreFile {
  version: 1;
  entries: Record<string, StoredAuthEntry>;
}

interface StoredEntryBase {
  kind: 'oauth2' | 'apiKey' | 'http-bearer';
  apiName: string;
  apiPrefix: string;
  schemeName: string;
  schemePrefix: string;
  updatedAt: string;
}

export interface StoredOAuth2Entry extends StoredEntryBase {
  kind: 'oauth2';
  accessToken: string;
  expiresAt?: string;
}

export interface StoredTokenEntry extends StoredEntryBase {
  kind: 'apiKey' | 'http-bearer';
  token: string;
}

export type StoredAuthEntry = StoredOAuth2Entry | StoredTokenEntry;

export interface AuthStoreTokenResult {
  token: string;
  kind: StoredAuthEntry['kind'];
  expiresAt?: number;
}

export class AuthStore {
  constructor(public readonly filePath: string) {}

  async getToken(
    apiName: string,
    schemeName: string,
  ): Promise<AuthStoreTokenResult | undefined> {
    const data = await this.read();
    const key = schemePrefix(apiName, schemeName);
    const entry = data.entries[key];
    if (!entry) {
      return undefined;
    }

    if (entry.kind === 'oauth2') {
      const expiresAt = entry.expiresAt
        ? Date.parse(entry.expiresAt)
        : undefined;
      if (
        expiresAt !== undefined &&
        Number.isFinite(expiresAt) &&
        expiresAt <= Date.now()
      ) {
        return undefined;
      }
      return {
        token: entry.accessToken,
        kind: entry.kind,
        expiresAt:
          expiresAt !== undefined && Number.isFinite(expiresAt)
            ? expiresAt
            : undefined,
      };
    }

    return {
      token: entry.token,
      kind: entry.kind,
    };
  }

  async setOAuth2Token(input: {
    apiName: string;
    schemeName: string;
    accessToken: string;
    expiresAt?: number;
  }): Promise<StoredOAuth2Entry> {
    const entry: StoredOAuth2Entry = {
      kind: 'oauth2',
      apiName: input.apiName,
      apiPrefix: apiPrefix(input.apiName),
      schemeName: input.schemeName,
      schemePrefix: schemePrefix(input.apiName, input.schemeName),
      accessToken: input.accessToken,
      updatedAt: new Date().toISOString(),
      ...(input.expiresAt
        ? { expiresAt: new Date(input.expiresAt).toISOString() }
        : {}),
    };
    await this.writeEntry(entry);
    return entry;
  }

  async setToken(input: {
    apiName: string;
    schemeName: string;
    kind: 'apiKey' | 'http-bearer';
    token: string;
  }): Promise<StoredTokenEntry> {
    const entry: StoredTokenEntry = {
      kind: input.kind,
      apiName: input.apiName,
      apiPrefix: apiPrefix(input.apiName),
      schemeName: input.schemeName,
      schemePrefix: schemePrefix(input.apiName, input.schemeName),
      token: input.token,
      updatedAt: new Date().toISOString(),
    };
    await this.writeEntry(entry);
    return entry;
  }

  private async writeEntry(entry: StoredAuthEntry): Promise<void> {
    const data = await this.read();
    data.entries[entry.schemePrefix] = entry;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify(data, null, 2)}\n`,
      'utf-8',
    );
    try {
      await chmod(this.filePath, 0o600);
    } catch {
      // Ignore chmod failures on platforms/filesystems that do not support POSIX modes.
    }
  }

  private async read(): Promise<AuthStoreFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { version: AUTH_STORE_VERSION, entries: {} };
      }
      throw new OpenApiMcpError('CONFIG_ERROR', 'Failed to read auth store', {
        filePath: this.filePath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new OpenApiMcpError('CONFIG_ERROR', 'Invalid auth store JSON', {
        filePath: this.filePath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new OpenApiMcpError(
        'CONFIG_ERROR',
        'Invalid auth store structure',
        {
          filePath: this.filePath,
        },
      );
    }

    const candidate = parsed as Partial<AuthStoreFile>;
    if (
      candidate.version !== AUTH_STORE_VERSION ||
      !candidate.entries ||
      typeof candidate.entries !== 'object' ||
      Array.isArray(candidate.entries)
    ) {
      throw new OpenApiMcpError(
        'CONFIG_ERROR',
        'Invalid auth store structure',
        {
          filePath: this.filePath,
        },
      );
    }

    return {
      version: AUTH_STORE_VERSION,
      entries: candidate.entries,
    };
  }
}

export function resolveAuthStorePath(
  configPath: string,
  explicitPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const envPath = env[AUTH_STORE_ENV_VAR];
  if (envPath) {
    return path.resolve(envPath);
  }

  return path.resolve(
    path.dirname(configPath),
    '.openapi-dynamic-mcp-auth.json',
  );
}
