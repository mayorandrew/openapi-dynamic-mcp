import nock from 'nock';
import { prepareEndpointRequest } from '../../src/http/requestExecutor.js';
import type { ToolContext } from '../../src/mcp/context.js';
import type { ApiDefinition, EndpointDefinition } from '../../src/types.js';

export function buildPathParams(
  endpoint: EndpointDefinition,
): Record<string, unknown> | undefined {
  const params = [
    ...(endpoint.pathItem.parameters ?? []),
    ...(endpoint.operation.parameters ?? []),
  ];
  const pathParams: Record<string, unknown> = {};
  for (const param of params) {
    if ('$ref' in param || param.in !== 'path') {
      continue;
    }
    pathParams[param.name] = placeholderValue(param.schema);
  }
  return Object.keys(pathParams).length > 0 ? pathParams : undefined;
}

function placeholderValue(schema: unknown): unknown {
  if (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    !('type' in schema)
  ) {
    return 'sample';
  }

  switch ((schema as { type?: string }).type) {
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return ['sample'];
    case 'object':
      return { sample: 'value' };
    default:
      return 'sample';
  }
}

export function snapshotify<T>(value: T): T {
  const copy = structuredClone(value);
  if (copy && typeof copy === 'object') {
    if ('structuredContent' in copy) {
      const structuredContent = copy.structuredContent;
      if (
        structuredContent &&
        typeof structuredContent === 'object' &&
        'timingMs' in structuredContent
      ) {
        structuredContent.timingMs = '<timing>';
      }
    }

    if ('content' in copy && Array.isArray(copy.content)) {
      for (const item of copy.content) {
        if (
          item &&
          typeof item === 'object' &&
          'text' in item &&
          typeof item.text === 'string'
        ) {
          item.text = item.text.replace(
            /"timingMs": \d+/g,
            '"timingMs": "<timing>"',
          );
        }
      }
    }
  }

  return copy;
}

export async function mockEndpointRequest(
  context: ToolContext,
  api: ApiDefinition,
  endpoint: EndpointDefinition,
): Promise<{
  endpointId: string;
  pathParams?: Record<string, unknown>;
  body?: unknown;
  files?: Record<
    string,
    { name?: string; contentType?: string; text?: string }
  >;
  contentType?: string;
}> {
  const pathParams = buildPathParams(endpoint);
  const requestInput = buildRequestInput(endpoint);
  const prepared = await prepareEndpointRequest({
    api,
    endpoint,
    pathParams: pathParams ?? {},
    query: {},
    headers: {},
    cookies: {},
    body: requestInput.body,
    files: requestInput.files,
    contentType: requestInput.contentType,
    oauthClient: context.oauthClient,
    authStore: context.authStore,
    env: context.env,
  });
  const requestUrl = new URL(prepared.request.url);

  nock(requestUrl.origin)
    .intercept(requestUrl.pathname, prepared.request.method)
    .query(true)
    .reply(200, { success: true }, { 'content-type': 'application/json' });

  return {
    endpointId: endpoint.endpointId,
    pathParams,
    body: requestInput.body,
    files: requestInput.files,
    contentType: requestInput.contentType,
  };
}

function buildRequestInput(endpoint: EndpointDefinition): {
  body?: unknown;
  files?: Record<
    string,
    { name?: string; contentType?: string; text?: string }
  >;
  contentType?: string;
} {
  const contentTypes = Object.keys(
    endpoint.operation.requestBody?.content ?? {},
  );
  const contentType = contentTypes.find(isSupportedMockContentType);
  if (!contentType) {
    return {};
  }

  if (contentType.includes('multipart/form-data')) {
    return {
      contentType,
      files: {
        file: {
          name: 'sample.txt',
          contentType: 'text/plain',
          text: 'sample',
        },
      },
    };
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return {
      contentType,
      body: { sample: 'value' },
    };
  }

  if (contentType.startsWith('text/')) {
    return {
      contentType,
      body: 'sample',
    };
  }

  if (
    contentType.includes('application/octet-stream') ||
    contentType.startsWith('image/') ||
    contentType.includes('pdf')
  ) {
    return {
      contentType,
      files: {
        file: {
          name: 'sample.bin',
          contentType,
          text: 'sample',
        },
      },
    };
  }

  return {
    contentType,
    body: { sample: 'value' },
  };
}

function isSupportedMockContentType(contentType: string): boolean {
  return (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/json') ||
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.startsWith('text/') ||
    contentType.includes('application/octet-stream') ||
    contentType.startsWith('image/') ||
    contentType.includes('pdf')
  );
}
