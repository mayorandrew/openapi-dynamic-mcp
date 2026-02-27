import type { OpenAPIV3 } from 'openapi-types';
import { readFile } from 'node:fs/promises';
import { readApiExtraHeaders } from '../auth/env.js';
import { OAuthClient } from '../auth/oauthClient.js';
import { resolveAuth } from '../auth/resolveAuth.js';
import { OpenApiMcpError } from '../errors.js';
import type {
  EndpointDefinition,
  LoadedApi,
  RequestExecutionResult,
  Retry429Config,
  McpFileDescriptor,
} from '../types.js';
import { isMcpFileDescriptor } from '../types.js';

interface RequestExecutorInput {
  api: LoadedApi;
  endpoint: EndpointDefinition;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: unknown;
  files?: Record<string, McpFileDescriptor>;
  contentType?: string;
  accept?: string;
  timeoutMs?: number;
  retry429?: Retry429Config;
  oauthClient: OAuthClient;
  env?: NodeJS.ProcessEnv;
}

interface ResolvedRetry429Options {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  respectRetryAfter: boolean;
}

const TEXT_CONTENT_TYPE_PATTERNS = [
  /^text\//i,
  /^application\/xml/i,
  /^application\/x-www-form-urlencoded/i,
  /^application\/graphql/i,
];
const DEFAULT_RETRY_429_OPTIONS: ResolvedRetry429Options = {
  maxRetries: 0,
  baseDelayMs: 250,
  maxDelayMs: 5000,
  jitterRatio: 0.2,
  respectRetryAfter: true,
};

export async function executeEndpointRequest(
  input: RequestExecutorInput,
): Promise<RequestExecutionResult> {
  const env = input.env ?? process.env;
  const start = Date.now();
  const auth = await resolveAuth({
    api: input.api,
    endpoint: input.endpoint,
    oauthClient: input.oauthClient,
    env,
  });

  const url = new URL(
    joinBaseAndPath(
      input.api.baseUrl,
      expandPath(input.endpoint.path, input.pathParams),
    ),
  );
  appendQueryParams(url.searchParams, input.endpoint, input.query ?? {});

  const mergedHeaders: Record<string, string> = {
    ...(input.api.config.headers ?? {}),
    ...readApiExtraHeaders(input.api.config.name, env),
    ...(input.headers ?? {}),
  };

  if (input.accept) {
    mergedHeaders.accept = input.accept;
  }

  const cookieMap: Record<string, string> = { ...(input.cookies ?? {}) };

  for (const scheme of auth.schemes) {
    if (scheme.type === 'apiKey') {
      if (scheme.in === 'header') {
        mergedHeaders[scheme.name] = scheme.value;
      } else if (scheme.in === 'query') {
        url.searchParams.set(scheme.name, scheme.value);
      } else {
        cookieMap[scheme.name] = scheme.value;
      }
      continue;
    }

    if (scheme.type === 'http') {
      if (scheme.scheme === 'bearer') {
        mergedHeaders.authorization = `Bearer ${scheme.token}`;
      } else if (scheme.scheme === 'basic') {
        const credentials = Buffer.from(
          `${scheme.username}:${scheme.password}`,
        ).toString('base64');
        mergedHeaders.authorization = `Basic ${credentials}`;
      }
      continue;
    }

    if (scheme.type === 'oauth2') {
      mergedHeaders.authorization = `Bearer ${scheme.token}`;
      continue;
    }
  }

  if (Object.keys(cookieMap).length > 0) {
    mergedHeaders.cookie = Object.entries(cookieMap)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join('; ');
  }

  const { body, inferredContentType, isFormData } = await prepareRequestBody(
    input.body,
    input.files,
    input.contentType,
  );
  if (isFormData) {
    // Delete content-type so fetch can set it with the correct multipart boundary
    for (const key of Object.keys(mergedHeaders)) {
      if (key.toLowerCase() === 'content-type') {
        delete mergedHeaders[key];
      }
    }
  } else if (inferredContentType && !hasHeader(mergedHeaders, 'content-type')) {
    mergedHeaders['content-type'] = inferredContentType;
  }

  const timeoutMs = input.timeoutMs ?? input.api.config.timeoutMs ?? 30000;
  const retry429 = resolveRetry429Options(
    input.api.config.retry429,
    input.retry429,
  );

  let response: Response | undefined;
  for (let attempt = 0; attempt <= retry429.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(url, {
        method: input.endpoint.method.toUpperCase(),
        headers: mergedHeaders,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OpenApiMcpError(
          'REQUEST_ERROR',
          `Request timed out after ${timeoutMs}ms`,
          {
            apiName: input.api.config.name,
            endpointId: input.endpoint.endpointId,
          },
        );
      }

      throw new OpenApiMcpError('REQUEST_ERROR', 'Request failed', {
        cause: error instanceof Error ? error.message : String(error),
        apiName: input.api.config.name,
        endpointId: input.endpoint.endpointId,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status !== 429 || attempt >= retry429.maxRetries) {
      break;
    }

    const delayMs = computeRetryDelayMs(
      response.headers.get('retry-after'),
      attempt,
      retry429,
    );
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  if (!response) {
    throw new OpenApiMcpError('REQUEST_ERROR', 'Request failed', {
      apiName: input.api.config.name,
      endpointId: input.endpoint.endpointId,
    });
  }

  const responseHeaders = Object.fromEntries(response.headers.entries());
  const responseBody = await decodeResponseBody(response);

  return {
    request: {
      url: url.toString(),
      method: input.endpoint.method.toUpperCase(),
      headersRedacted: redactHeaders(mergedHeaders),
      endpointId: input.endpoint.endpointId,
    },
    response: {
      status: response.status,
      headers: responseHeaders,
      ...responseBody,
    },
    timingMs: Date.now() - start,
    authUsed: auth.authUsed,
  };
}

function resolveRetry429Options(
  configOptions: Retry429Config | undefined,
  inputOptions: Retry429Config | undefined,
): ResolvedRetry429Options {
  const maxRetries =
    inputOptions?.maxRetries ??
    configOptions?.maxRetries ??
    DEFAULT_RETRY_429_OPTIONS.maxRetries;
  const baseDelayMs =
    inputOptions?.baseDelayMs ??
    configOptions?.baseDelayMs ??
    DEFAULT_RETRY_429_OPTIONS.baseDelayMs;
  const maxDelayMs =
    inputOptions?.maxDelayMs ??
    configOptions?.maxDelayMs ??
    DEFAULT_RETRY_429_OPTIONS.maxDelayMs;
  const jitterRatio =
    inputOptions?.jitterRatio ??
    configOptions?.jitterRatio ??
    DEFAULT_RETRY_429_OPTIONS.jitterRatio;
  const respectRetryAfter =
    inputOptions?.respectRetryAfter ??
    configOptions?.respectRetryAfter ??
    DEFAULT_RETRY_429_OPTIONS.respectRetryAfter;

  return {
    maxRetries: Math.max(0, Math.floor(maxRetries)),
    baseDelayMs: Math.max(1, Math.floor(baseDelayMs)),
    maxDelayMs: Math.max(1, Math.floor(maxDelayMs)),
    jitterRatio: Math.min(1, Math.max(0, jitterRatio)),
    respectRetryAfter,
  };
}

function computeRetryDelayMs(
  retryAfterHeader: string | null,
  retryIndex: number,
  options: ResolvedRetry429Options,
): number {
  if (options.respectRetryAfter) {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs !== undefined) {
      return Math.min(retryAfterMs, options.maxDelayMs);
    }
  }

  const exponential = options.baseDelayMs * 2 ** retryIndex;
  const capped = Math.min(exponential, options.maxDelayMs);
  if (options.jitterRatio === 0) {
    return capped;
  }

  const jitterMultiplier = 1 + (Math.random() * 2 - 1) * options.jitterRatio;
  const jittered = capped * jitterMultiplier;
  return Math.max(0, Math.min(options.maxDelayMs, jittered));
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (seconds <= 0) {
      return undefined;
    }
    return seconds * 1000;
  }

  const unixMs = Date.parse(trimmed);
  if (Number.isNaN(unixMs)) {
    return undefined;
  }

  const deltaMs = unixMs - Date.now();
  if (deltaMs <= 0) {
    return undefined;
  }
  return deltaMs;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function appendQueryParams(
  searchParams: URLSearchParams,
  endpoint: EndpointDefinition,
  query: Record<string, unknown>,
): void {
  const definedParams = collectParameters(endpoint).filter(
    (param): param is OpenAPIV3.ParameterObject =>
      !isReference(param) && param.in === 'query',
  );

  const byName = new Map<string, OpenAPIV3.ParameterObject>();
  for (const param of definedParams) {
    byName.set(param.name, param);
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    const param = byName.get(key);
    if (param) {
      serializeQueryValue(
        searchParams,
        key,
        value,
        param.style ?? 'form',
        param.explode ?? true,
      );
      continue;
    }

    serializeQueryValue(searchParams, key, value, 'form', true);
  }
}

function serializeQueryValue(
  searchParams: URLSearchParams,
  key: string,
  value: unknown,
  style: OpenAPIV3.ParameterObject['style'],
  explode: boolean,
): void {
  if (style === 'deepObject' && isPlainObject(value)) {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      if (nestedValue !== undefined && nestedValue !== null) {
        searchParams.append(
          `${key}[${nestedKey}]`,
          String(nestedValue as string | number | boolean),
        );
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    if (explode) {
      for (const item of value) {
        searchParams.append(key, String(item as string | number | boolean));
      }
      return;
    }

    searchParams.append(
      key,
      value.map((item) => String(item as string | number | boolean)).join(','),
    );
    return;
  }

  if (isPlainObject(value)) {
    if (explode) {
      for (const [itemKey, itemValue] of Object.entries(value)) {
        searchParams.append(
          itemKey,
          String(itemValue as string | number | boolean),
        );
      }
      return;
    }

    const flat: string[] = [];
    for (const [itemKey, itemValue] of Object.entries(value)) {
      flat.push(itemKey, String(itemValue as string | number | boolean));
    }
    searchParams.append(key, flat.join(','));
    return;
  }

  searchParams.append(key, String(value as string | number | boolean));
}

async function resolveFileContent(
  descriptor: McpFileDescriptor,
): Promise<{ blob: Blob; filename?: string }> {
  let buffer: Buffer;
  if ('base64' in descriptor) {
    buffer = Buffer.from(descriptor.base64, 'base64');
  } else if ('text' in descriptor) {
    buffer = Buffer.from(descriptor.text, 'utf-8');
  } else if ('filePath' in descriptor) {
    buffer = await readFile(descriptor.filePath);
  } else {
    throw new OpenApiMcpError(
      'REQUEST_ERROR',
      'File descriptor must have base64, text, or filePath',
    );
  }
  const type = descriptor.contentType ?? 'application/octet-stream';
  return {
    blob: new Blob([buffer], { type }),
    filename: descriptor.name,
  };
}

async function appendFormData(
  formData: FormData,
  key: string,
  value: unknown,
): Promise<void> {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      await appendFormData(formData, key, item);
    }
    return;
  }

  if (isMcpFileDescriptor(value)) {
    const { blob, filename } = await resolveFileContent(value);
    if (filename) {
      formData.append(key, blob, filename);
    } else {
      formData.append(key, blob);
    }
    return;
  }

  if (isPlainObject(value)) {
    formData.append(key, JSON.stringify(value));
    return;
  }

  formData.append(key, String(value as string | number | boolean));
}

async function prepareRequestBody(
  rawBody: unknown,
  files?: Record<string, McpFileDescriptor>,
  contentTypeOverride?: string,
): Promise<{
  body: any;
  inferredContentType?: string;
  isFormData?: boolean;
}> {
  const contentType = (contentTypeOverride ?? '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    const formData = new FormData();
    if (isPlainObject(rawBody)) {
      for (const [key, value] of Object.entries(rawBody)) {
        await appendFormData(formData, key, value);
      }
    }
    if (files) {
      for (const [key, value] of Object.entries(files)) {
        await appendFormData(formData, key, value);
      }
    }
    return { body: formData, isFormData: true };
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const searchParams = new URLSearchParams();
    if (isPlainObject(rawBody)) {
      for (const [key, value] of Object.entries(rawBody)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value)
            searchParams.append(key, String(item as string | number | boolean));
        } else if (isPlainObject(value)) {
          searchParams.append(key, JSON.stringify(value));
        } else {
          searchParams.append(key, String(value as string | number | boolean));
        }
      }
    }
    return {
      body: searchParams,
      inferredContentType: 'application/x-www-form-urlencoded',
    };
  }

  if ((rawBody === undefined || rawBody === null) && files) {
    const fileValues = Object.values(files);
    if (fileValues.length === 1) {
      const fileContent = await resolveFileContent(fileValues[0]);
      return {
        body: fileContent.blob,
        inferredContentType:
          contentTypeOverride ??
          fileValues[0].contentType ??
          'application/octet-stream',
      };
    } else if (fileValues.length > 1) {
      throw new OpenApiMcpError(
        'REQUEST_ERROR',
        'Multiple files provided but expected a single raw binary body',
      );
    }
  }

  if (rawBody === undefined || rawBody === null) {
    return { body: undefined, inferredContentType: undefined };
  }

  if (typeof rawBody === 'string') {
    return {
      body: rawBody,
      inferredContentType: contentTypeOverride ?? 'text/plain',
    };
  }

  if (rawBody instanceof Uint8Array || Buffer.isBuffer(rawBody)) {
    return {
      body: rawBody,
      inferredContentType: contentTypeOverride ?? 'application/octet-stream',
    };
  }

  return {
    body: JSON.stringify(rawBody),
    inferredContentType: contentTypeOverride ?? 'application/json',
  };
}

function expandPath(
  pathTemplate: string,
  pathParams: Record<string, unknown> | undefined,
): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_match, group: string) => {
    const value = pathParams?.[group];
    if (value === undefined || value === null) {
      throw new OpenApiMcpError(
        'REQUEST_ERROR',
        `Missing path parameter '${group}'`,
      );
    }

    if (Array.isArray(value)) {
      return value
        .map((item) =>
          encodeURIComponent(String(item as string | number | boolean)),
        )
        .join(',');
    }

    if (isPlainObject(value)) {
      const flat: string[] = [];
      for (const [k, v] of Object.entries(value)) {
        flat.push(k, String(v as string | number | boolean));
      }
      return encodeURIComponent(flat.join(','));
    }

    return encodeURIComponent(String(value as string | number | boolean));
  });
}

async function decodeResponseBody(
  response: Response,
): Promise<
  | { bodyType: 'empty' }
  | { bodyType: 'json'; bodyJson: unknown }
  | { bodyType: 'text'; bodyText: string }
  | { bodyType: 'binary'; bodyBase64: string }
> {
  if (response.status === 204 || response.status === 205) {
    return { bodyType: 'empty' };
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.toLowerCase().includes('json')) {
    const text = await response.text();
    if (!text) {
      return { bodyType: 'empty' };
    }

    try {
      return {
        bodyType: 'json',
        bodyJson: JSON.parse(text),
      };
    } catch {
      return {
        bodyType: 'text',
        bodyText: text,
      };
    }
  }

  if (
    TEXT_CONTENT_TYPE_PATTERNS.some((pattern) => pattern.test(contentType)) ||
    /charset=/i.test(contentType)
  ) {
    return {
      bodyType: 'text',
      bodyText: await response.text(),
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return { bodyType: 'empty' };
  }

  return {
    bodyType: 'binary',
    bodyBase64: Buffer.from(bytes).toString('base64'),
  };
}

function collectParameters(
  endpoint: EndpointDefinition,
): OpenAPIV3.ParameterObject[] {
  const pathParams = endpoint.pathItem.parameters ?? [];
  const operationParams = endpoint.operation.parameters ?? [];
  return [...pathParams, ...operationParams].filter(
    (param): param is OpenAPIV3.ParameterObject => !isReference(param),
  );
}

function isReference(
  value: OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject,
): value is OpenAPIV3.ReferenceObject {
  return '$ref' in value;
}

function joinBaseAndPath(baseUrl: string, apiPath: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${trimmedBase}${trimmedPath}`;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
}

function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower.includes('api-key') ||
      lower === 'cookie'
    ) {
      result[key] = '<redacted>';
      continue;
    }
    result[key] = value;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
