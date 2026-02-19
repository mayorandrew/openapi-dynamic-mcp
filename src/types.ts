import type { OpenAPIV3 } from 'openapi-types';

export interface ApiOauth2Config {
  tokenUrlOverride?: string;
  scopes?: string[];
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post';
}

export interface Retry429Config {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  respectRetryAfter?: boolean;
}

export interface ApiConfig {
  name: string;
  specPath: string;
  baseUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  oauth2?: ApiOauth2Config;
  retry429?: Retry429Config;
}

export interface RootConfig {
  version: 1;
  apis: ApiConfig[];
}

export type HttpMethod =
  | 'get'
  | 'put'
  | 'post'
  | 'delete'
  | 'options'
  | 'head'
  | 'patch'
  | 'trace';

export interface EndpointDefinition {
  endpointId: string;
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  operation: OpenAPIV3.OperationObject;
  pathItem: OpenAPIV3.PathItemObject;
}

export interface ResolvedApiKeyAuth {
  type: 'apiKey';
  schemeName: string;
  in: 'query' | 'header' | 'cookie';
  name: string;
  value: string;
}

export interface ResolvedOAuth2Auth {
  type: 'oauth2';
  schemeName: string;
  token: string;
}

export interface ResolvedHttpAuth {
  type: 'http';
  schemeName: string;
  scheme: 'bearer' | 'basic';
  token?: string;
  username?: string;
  password?: string;
}

export type ResolvedAuthScheme =
  | ResolvedApiKeyAuth
  | ResolvedOAuth2Auth
  | ResolvedHttpAuth;

export interface ResolvedAuthResult {
  authUsed: string[];
  schemes: ResolvedAuthScheme[];
}

export interface LoadedApi {
  config: ApiConfig;
  schemaPath: string;
  schema: OpenAPIV3.Document;
  baseUrl: string;
  endpoints: EndpointDefinition[];
  endpointById: Map<string, EndpointDefinition>;
  authSchemeNames: string[];
}

export interface ApiRegistry {
  byName: Map<string, LoadedApi>;
}

export interface MakeEndpointRequestInput {
  apiName: string;
  endpointId: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: unknown;
  contentType?: string;
  accept?: string;
  timeoutMs?: number;
  retry429?: Retry429Config;
}

export interface RequestExecutionResult {
  request: {
    url: string;
    method: string;
    headersRedacted: Record<string, string>;
    endpointId: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    bodyType: 'json' | 'text' | 'binary' | 'empty';
    bodyJson?: unknown;
    bodyText?: string;
    bodyBase64?: string;
  };
  timingMs: number;
  authUsed: string[];
}
