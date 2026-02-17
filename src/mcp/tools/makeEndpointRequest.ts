import { executeEndpointRequest } from "../../http/requestExecutor.js";
import { OpenApiMcpError } from "../../errors.js";
import type { ToolContext } from "../context.js";
import { z } from "zod";
import { fail, ok, parseInput, requireApi, toStringMap, type ToolResult } from "./common.js";

const makeEndpointRequestInputSchema = z
  .object({
    apiName: z.string().min(1),
    endpointId: z.string().min(1),
    pathParams: z.record(z.unknown()).nullable().optional(),
    query: z.record(z.unknown()).nullable().optional(),
    headers: z.record(z.unknown()).nullable().optional(),
    cookies: z.record(z.unknown()).nullable().optional(),
    body: z.unknown().optional(),
    contentType: z.string().optional(),
    accept: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    retry429: z
      .object({
        maxRetries: z.number().int().nonnegative().optional(),
        baseDelayMs: z.number().int().positive().optional(),
        maxDelayMs: z.number().int().positive().optional(),
        jitterRatio: z.number().min(0).max(1).optional(),
        respectRetryAfter: z.boolean().optional()
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict();

export async function makeEndpointRequestTool(
  context: ToolContext,
  args: unknown
): Promise<ToolResult> {
  try {
    const input = parseInput(args, makeEndpointRequestInputSchema);
    const apiName = input.apiName;
    const endpointId = input.endpointId;
    const api = requireApi(context, apiName);

    const endpoint = api.endpointById.get(endpointId);
    if (!endpoint) {
      throw new OpenApiMcpError("ENDPOINT_NOT_FOUND", `Unknown endpoint '${endpointId}'`, {
        apiName
      });
    }

    const result = await executeEndpointRequest({
      api,
      endpoint,
      pathParams: input.pathParams ?? {},
      query: input.query ?? {},
      headers: toStringMap(input.headers),
      cookies: toStringMap(input.cookies),
      body: input.body,
      contentType: input.contentType,
      accept: input.accept,
      timeoutMs: input.timeoutMs,
      retry429: input.retry429 ?? undefined,
      oauthClient: context.oauthClient,
      env: context.env
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
