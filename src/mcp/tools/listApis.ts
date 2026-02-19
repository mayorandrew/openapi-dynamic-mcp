import type { ToolContext } from '../context.js';
import { fail, ok, type ToolResult } from './common.js';

export async function listApisTool(context: ToolContext): Promise<ToolResult> {
  try {
    const apis = [...context.registry.byName.values()].map((api) => ({
      name: api.config.name,
      title: api.schema.info?.title,
      version: api.schema.info?.version,
      baseUrl: api.baseUrl,
      specPath: api.schemaPath,
      authSchemes: api.authSchemeNames,
    }));

    return ok({ apis });
  } catch (error) {
    return fail(error);
  }
}
