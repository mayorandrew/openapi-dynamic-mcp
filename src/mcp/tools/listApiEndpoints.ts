import type { ToolContext } from '../context.js';
import { z } from 'zod';
import { fail, ok, parseInput, requireApi, type ToolResult } from './common.js';

const listApiEndpointsInputSchema = z
  .object({
    apiName: z.string().min(1),
    method: z.string().optional(),
    tag: z.string().optional(),
    pathContains: z.string().optional(),
    search: z.array(z.string()).optional(),
    limit: z.number().int().positive().optional(),
    cursor: z.string().optional(),
  })
  .strict();

export async function listApiEndpointsTool(
  context: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  try {
    const input = parseInput(args, listApiEndpointsInputSchema);
    const api = requireApi(context, input.apiName);

    const methodFilter = input.method?.toLowerCase();
    const tagFilter = input.tag;
    const pathContains = input.pathContains;
    const searchTerms = input.search?.map((s) => s.trim().toLowerCase()) ?? [];
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

        // Check if ANY search term matches any field in the haystack (OR logic)
        const matchesAnyTerm = searchTerms.some((term) =>
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

    return ok({
      endpoints: paged.map((endpoint) => ({
        endpointId: endpoint.endpointId,
        method: endpoint.method,
        path: endpoint.path,
        operationId: endpoint.operationId,
        summary: endpoint.summary,
        tags: endpoint.tags ?? [],
      })),
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined,
    });
  } catch (error) {
    return fail(error);
  }
}
