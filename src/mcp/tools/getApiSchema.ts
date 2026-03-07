import type { ToolContext } from '../context.js';
import { getByJsonPointer } from '../../openapi/jsonPointer.js';
import { z } from 'zod';
import { fail, ok, parseInput, requireApi, type ToolResult } from './common.js';

const getApiSchemaInputSchema = z
  .object({
    apiName: z.string().min(1),
    pointer: z.string().optional(),
  })
  .strict();

export async function getApiSchemaTool(
  context: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  try {
    const input = parseInput(args, getApiSchemaInputSchema);
    const apiName = input.apiName;
    const pointer = input.pointer;

    const api = requireApi(context, apiName);
    const schema = getByJsonPointer(api.schema, pointer);

    const SIZE_WARNING_THRESHOLD = 200_000;
    const serialized = JSON.stringify(schema);
    const result: Record<string, unknown> = {
      apiName: api.config.name,
      pointer: pointer ?? '',
      schema,
    };
    if (serialized.length > SIZE_WARNING_THRESHOLD) {
      result._sizeWarning = `Response is ${serialized.length} bytes. Consider using a more specific JSON pointer to reduce payload size.`;
    }

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
