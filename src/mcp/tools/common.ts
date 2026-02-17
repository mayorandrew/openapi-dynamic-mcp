import { asErrorResponse, OpenApiMcpError } from "../../errors.js";
import type { LoadedApi } from "../../types.js";
import type { ToolContext } from "../context.js";
import { z } from "zod";

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
}

export function ok(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

export function fail(error: unknown): ToolResult {
  const payload = asErrorResponse(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

export function requireApi(context: ToolContext, apiName: string): LoadedApi {
  const api = context.registry.byName.get(apiName.toLowerCase());
  if (!api) {
    throw new OpenApiMcpError("API_NOT_FOUND", `Unknown API '${apiName}'`);
  }
  return api;
}

export function parseInput<T extends z.ZodTypeAny>(
  args: unknown,
  schema: T
): z.infer<T> {
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  const issue = parsed.error.issues[0];
  const path = issue.path.length ? issue.path.join(".") : "arguments";
  throw new OpenApiMcpError("REQUEST_ERROR", `${path}: ${issue.message}`, {
    issues: parsed.error.issues.map((item) => ({
      path: item.path,
      message: item.message
    }))
  });
}

export function toStringMap(
  value: Record<string, unknown> | undefined | null
): Record<string, string> {
  if (!value) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) {
      continue;
    }
    out[key] = String(item);
  }
  return out;
}
