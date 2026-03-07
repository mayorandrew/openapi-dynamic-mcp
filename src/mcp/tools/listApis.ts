import type { ToolContext } from '../context.js';
import { z } from 'zod';
import {
  runMcpTool,
  withFields,
  type ToolDefinition,
  type ToolResult,
} from './common.js';

const listApisInputSchema = withFields(z.object({}).strict());

const listApisOutputSchema = z.object({
  apis: z.array(
    z.object({
      name: z.string(),
      title: z.string().optional(),
      version: z.string().optional(),
      baseUrl: z.string(),
      specPath: z.string(),
      authSchemes: z.array(z.string()),
    }),
  ),
});

type ListApisInput = z.infer<typeof listApisInputSchema>;
type ListApisOutput = z.infer<typeof listApisOutputSchema>;

export const listApisToolDefinition: ToolDefinition<
  ListApisInput,
  ListApisOutput
> = {
  name: 'list_apis',
  description: 'List configured APIs loaded from the YAML configuration.',
  inputSchema: listApisInputSchema,
  outputSchema: listApisOutputSchema,
  async execute(context: ToolContext) {
    return {
      apis: [...context.registry.byName.values()].map((api) => ({
        name: api.config.name,
        title: api.schema.info?.title,
        version: api.schema.info?.version,
        baseUrl: api.baseUrl,
        specPath: api.schemaPath,
        authSchemes: api.authSchemeNames,
      })),
    };
  },
};

export async function listApisTool(
  context: ToolContext,
  args?: unknown,
): Promise<ToolResult> {
  return runMcpTool(listApisToolDefinition, context, args ?? {});
}
