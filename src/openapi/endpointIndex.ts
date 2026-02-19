import type { OpenAPIV3 } from 'openapi-types';
import { OpenApiMcpError } from '../errors.js';
import type { EndpointDefinition, HttpMethod } from '../types.js';

const METHODS: HttpMethod[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

function normalizePathForId(path: string): string {
  return path.replace(/\s+/g, '').replace(/\/+$/, '') || '/';
}

export function buildEndpointIndex(document: OpenAPIV3.Document): {
  endpoints: EndpointDefinition[];
  endpointById: Map<string, EndpointDefinition>;
} {
  const paths = document.paths ?? {};
  const opIdCounts = new Map<string, number>();

  for (const path of Object.keys(paths)) {
    const item = paths[path];
    if (!item) {
      continue;
    }
    for (const method of METHODS) {
      const op = item[method];
      if (op?.operationId) {
        opIdCounts.set(
          op.operationId,
          (opIdCounts.get(op.operationId) ?? 0) + 1,
        );
      }
    }
  }

  const endpoints: EndpointDefinition[] = [];
  const endpointById = new Map<string, EndpointDefinition>();

  for (const path of Object.keys(paths)) {
    const pathItem = paths[path];
    if (!pathItem) {
      continue;
    }

    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      const uniqueOpId =
        operation.operationId && opIdCounts.get(operation.operationId) === 1
          ? operation.operationId
          : undefined;
      const endpointId =
        uniqueOpId ?? `${method.toUpperCase()} ${normalizePathForId(path)}`;

      const endpoint: EndpointDefinition = {
        endpointId,
        method,
        path,
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags,
        operation,
        pathItem: pathItem as OpenAPIV3.PathItemObject,
      };

      if (endpointById.has(endpointId)) {
        throw new OpenApiMcpError(
          'SCHEMA_ERROR',
          `Endpoint ID collision for '${endpointId}'`,
          {
            path,
            method,
          },
        );
      }

      endpointById.set(endpointId, endpoint);
      endpoints.push(endpoint);
    }
  }

  endpoints.sort((a, b) => {
    if (a.path === b.path) {
      return a.method.localeCompare(b.method);
    }
    return a.path.localeCompare(b.path);
  });

  return { endpoints, endpointById };
}
