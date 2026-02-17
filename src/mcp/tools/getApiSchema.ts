import type { ToolContext } from "../context.js";
import { getByJsonPointer } from "../../openapi/jsonPointer.js";
import { z } from "zod";
import { fail, ok, parseInput, requireApi, type ToolResult } from "./common.js";

const getApiSchemaInputSchema = z
  .object({
    apiName: z.string().min(1),
    pointer: z.string().optional()
  })
  .strict();

export async function getApiSchemaTool(context: ToolContext, args: unknown): Promise<ToolResult> {
  try {
    const input = parseInput(args, getApiSchemaInputSchema);
    const apiName = input.apiName;
    const pointer = input.pointer;

    const api = requireApi(context, apiName);
    const schema = getByJsonPointer(api.schema, pointer);

    return ok({
      apiName: api.config.name,
      pointer: pointer ?? "",
      schema
    });
  } catch (error) {
    return fail(error);
  }
}
