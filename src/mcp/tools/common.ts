import { asErrorResponse, OpenApiMcpError } from '../../errors.js';
import type { LoadedApi } from '../../types.js';
import type { ToolContext } from '../context.js';
import { applyJsonPathFields } from '../../output/jsonPath.js';
import { toJsonSchemaCompat } from '../../vendor/mcpJsonSchema.js';
import { z } from 'zod';

export interface ToolResult {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
  structuredContent?: unknown;
}

export interface ToolDefinition<TInput extends { fields?: string[] }, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute: (
    context: ToolContext,
    input: Omit<TInput, 'fields'>,
  ) => Promise<TOutput>;
}

export function ok(data: unknown): ToolResult {
  return {
    isError: undefined,
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

export function fail(error: unknown): ToolResult {
  const payload = asErrorResponse(error);
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

export function requireApi(context: ToolContext, apiName: string): LoadedApi {
  const api = context.registry.byName.get(apiName.toLowerCase());
  if (!api) {
    throw new OpenApiMcpError('API_NOT_FOUND', `Unknown API '${apiName}'`);
  }
  return api;
}

export function parseInput<T>(args: unknown, schema: z.ZodType<T>): T {
  const parsed: z.SafeParseReturnType<unknown, T> = schema.safeParse(
    args ?? {},
  );
  if (parsed.success) {
    return parsed.data;
  }

  const issue = parsed.error.issues[0];
  const path = issue.path.length ? issue.path.join('.') : 'arguments';
  throw new OpenApiMcpError('REQUEST_ERROR', `${path}: ${issue.message}`, {
    issues: parsed.error.issues.map((item) => ({
      path: item.path,
      message: item.message,
    })),
  });
}

export function validateOutput<T>(data: unknown, schema: z.ZodType<T>): T {
  const parsed: z.SafeParseReturnType<unknown, T> = schema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }

  throw new OpenApiMcpError('SCHEMA_ERROR', 'Tool output validation failed', {
    issues: parsed.error.issues.map((item) => ({
      path: item.path,
      message: item.message,
    })),
  });
}

export async function executeToolData<
  TInput extends { fields?: string[] },
  TOutput,
>(
  definition: ToolDefinition<TInput, TOutput>,
  context: ToolContext,
  args: unknown,
): Promise<TOutput> {
  const input = parseInput(args, definition.inputSchema);
  const { fields, ...toolInput } = input;
  const data = await definition.execute(context, toolInput);
  const validated = validateOutput(data, definition.outputSchema);
  return applyJsonPathFields(validated, fields);
}

export async function runMcpTool<TInput extends { fields?: string[] }, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
  context: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  try {
    return ok(await executeToolData(definition, context, args));
  } catch (error) {
    return fail(error);
  }
}

export function toToolDescriptor<TInput extends { fields?: string[] }, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
} {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: toJsonSchemaCompat(definition.inputSchema),
    outputSchema: toJsonSchemaCompat(definition.outputSchema),
  };
}

export function withFields<T extends z.AnyZodObject>(
  schema: T,
): z.ZodType<z.infer<T> & { fields?: string[] }> {
  return schema.extend({
    fields: z.array(z.string()).optional(),
  }) as unknown as z.ZodType<z.infer<T> & { fields?: string[] }>;
}

export function toStringMap(
  value: Record<string, unknown> | undefined | null,
): Record<string, string> {
  if (!value) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) {
      continue;
    }
    out[key] = String(item as string | number | boolean);
  }
  return out;
}
