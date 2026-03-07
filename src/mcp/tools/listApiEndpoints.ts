import type { ToolContext } from '../context.js';
import { z } from 'zod';
import {
  requireApi,
  runMcpTool,
  withFields,
  type ToolDefinition,
  type ToolResult,
} from './common.js';

const listApiEndpointsInputSchema = withFields(
  z
    .object({
      apiName: z.string().min(1),
      method: z.string().optional(),
      tag: z.string().optional(),
      pathContains: z.string().optional(),
      search: z.array(z.string()).optional(),
      limit: z.number().int().positive().optional(),
      cursor: z.string().optional(),
    })
    .strict(),
);

const listApiEndpointsOutputSchema = z.object({
  endpoints: z.array(
    z.object({
      endpointId: z.string(),
      method: z.string(),
      path: z.string(),
      operationId: z.string().optional(),
      summary: z.string().optional(),
      tags: z.array(z.string()),
    }),
  ),
  nextCursor: z.string().optional(),
});

type ListApiEndpointsInput = z.infer<typeof listApiEndpointsInputSchema>;
type ListApiEndpointsOutput = z.infer<typeof listApiEndpointsOutputSchema>;

export const listApiEndpointsToolDefinition: ToolDefinition<
  ListApiEndpointsInput,
  ListApiEndpointsOutput
> = {
  name: 'list_api_endpoints',
  description: 'List endpoints from a specific API with optional filters.',
  inputSchema: listApiEndpointsInputSchema,
  outputSchema: listApiEndpointsOutputSchema,
  async execute(context, input) {
    const api = requireApi(context, input.apiName);

    const methodFilter = input.method?.toLowerCase();
    const tagFilter = input.tag;
    const pathContains = input.pathContains;
    const searchTerms =
      input.search?.map((term: string) => term.trim().toLowerCase()) ?? [];
    const limit = Math.min(input.limit ?? 50, 200);
    const offset =
      typeof input.cursor === 'string' && input.cursor.trim()
        ? Number.parseInt(input.cursor, 10)
        : 0;

    const filtered = api.endpoints.filter((endpoint) => {
      if (methodFilter && endpoint.method !== methodFilter) {
        return false;
      }

      if (tagFilter && !(endpoint.tags ?? []).includes(tagFilter)) {
        return false;
      }

      if (pathContains && !endpoint.path.includes(pathContains)) {
        return false;
      }

      if (searchTerms.length > 0) {
        const haystack = [
          endpoint.endpointId,
          endpoint.method,
          endpoint.path,
          endpoint.operationId,
          endpoint.summary,
          endpoint.description,
          ...(endpoint.tags ?? []),
        ]
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.toLowerCase());

        const matchesAnyTerm = searchTerms.some((term: string) =>
          haystack.some((value) => value.includes(term)),
        );

        if (!matchesAnyTerm) {
          return false;
        }
      }

      return true;
    });

    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const paged = filtered.slice(safeOffset, safeOffset + limit);
    const nextOffset = safeOffset + paged.length;

    return {
      endpoints: paged.map((endpoint) => ({
        endpointId: endpoint.endpointId,
        method: endpoint.method,
        path: endpoint.path,
        operationId: endpoint.operationId,
        summary: endpoint.summary,
        tags: endpoint.tags ?? [],
      })),
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined,
    };
  },
};

export async function listApiEndpointsTool(
  context: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  return runMcpTool(listApiEndpointsToolDefinition, context, args);
}
