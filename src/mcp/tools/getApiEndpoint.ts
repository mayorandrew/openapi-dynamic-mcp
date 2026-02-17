import type { OpenAPIV3 } from "openapi-types";
import { OpenApiMcpError } from "../../errors.js";
import type { ToolContext } from "../context.js";
import { z } from "zod";
import { fail, ok, parseInput, requireApi, type ToolResult } from "./common.js";

const getApiEndpointInputSchema = z
  .object({
    apiName: z.string().min(1),
    endpointId: z.string().min(1)
  })
  .strict();

export async function getApiEndpointTool(context: ToolContext, args: unknown): Promise<ToolResult> {
  try {
    const input = parseInput(args, getApiEndpointInputSchema);
    const apiName = input.apiName;
    const endpointId = input.endpointId;

    const api = requireApi(context, apiName);
    const endpoint = api.endpointById.get(endpointId);
    if (!endpoint) {
      throw new OpenApiMcpError("ENDPOINT_NOT_FOUND", `Unknown endpoint '${endpointId}'`, {
        apiName
      });
    }

    const parameters = [...(endpoint.pathItem.parameters ?? []), ...(endpoint.operation.parameters ?? [])]
      .filter((item): item is OpenAPIV3.ParameterObject => !("$ref" in item))
      .map((param) => ({
        name: param.name,
        in: param.in,
        required: param.required ?? false,
        description: param.description,
        style: param.style,
        explode: param.explode,
        schema: param.schema
      }));

    const requestContentTypes = Object.keys(endpoint.operation.requestBody && "$ref" in endpoint.operation.requestBody
      ? {}
      : endpoint.operation.requestBody?.content ?? {});

    return ok({
      endpointId: endpoint.endpointId,
      method: endpoint.method,
      path: endpoint.path,
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      description: endpoint.description,
      tags: endpoint.tags ?? [],
      parameters,
      requestBody: {
        required:
          endpoint.operation.requestBody && !("$ref" in endpoint.operation.requestBody)
            ? endpoint.operation.requestBody.required ?? false
            : false,
        contentTypes: requestContentTypes
      },
      responses: endpoint.operation.responses,
      security: endpoint.operation.security ?? api.schema.security ?? []
    });
  } catch (error) {
    return fail(error);
  }
}
