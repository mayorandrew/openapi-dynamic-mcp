import type { ToolContext } from '../context.js';
import { getByJsonPointer } from '../../openapi/jsonPointer.js';
import { z } from 'zod';
import {
  requireApi,
  runMcpTool,
  withFields,
  type ToolDefinition,
  type ToolResult,
} from './common.js';

const getApiSchemaInputSchema = withFields(
  z
    .object({
      apiName: z.string().min(1),
      pointer: z.string().optional(),
    })
    .strict(),
);

const getApiSchemaOutputSchema = z.object({
  apiName: z.string(),
  pointer: z.string(),
  schema: z.unknown(),
  _sizeWarning: z.string().optional(),
});

type GetApiSchemaInput = z.infer<typeof getApiSchemaInputSchema>;
type GetApiSchemaOutput = z.infer<typeof getApiSchemaOutputSchema>;

export const getApiSchemaToolDefinition: ToolDefinition<
  GetApiSchemaInput,
  GetApiSchemaOutput
> = {
  name: 'get_api_schema',
  description:
    'Get the full dereferenced API schema or a JSON pointer fragment.',
  inputSchema: getApiSchemaInputSchema,
  outputSchema: getApiSchemaOutputSchema,
  async execute(context, input) {
    const api = requireApi(context, input.apiName);
    const schema = getByJsonPointer(api.schema, input.pointer);

    const SIZE_WARNING_THRESHOLD = 200_000;
    const serialized = JSON.stringify(schema);
    const result: z.infer<typeof getApiSchemaOutputSchema> = {
      apiName: api.config.name,
      pointer: input.pointer ?? '',
      schema,
    };
    if (serialized.length > SIZE_WARNING_THRESHOLD) {
      result._sizeWarning = `Response is ${serialized.length} bytes. Consider using a more specific JSON pointer to reduce payload size.`;
    }

    return result;
  },
};

export async function getApiSchemaTool(
  context: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  return runMcpTool(getApiSchemaToolDefinition, context, args);
}
