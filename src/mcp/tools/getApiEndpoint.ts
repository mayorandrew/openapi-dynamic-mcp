import type { OpenAPIV3 } from 'openapi-types';
import { OpenApiMcpError } from '../../errors.js';
import type { ToolContext } from '../context.js';
import { z } from 'zod';
import {
  requireApi,
  runMcpTool,
  withFields,
  type ToolDefinition,
  type ToolResult,
} from './common.js';

const getApiEndpointInputSchema = withFields(
  z
    .object({
      apiName: z.string().min(1),
      endpointId: z.string().min(1),
    })
    .strict(),
);

const getApiEndpointOutputSchema = z.object({
  endpointId: z.string(),
  method: z.string(),
  path: z.string(),
  operationId: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  parameters: z.array(
    z.object({
      name: z.string(),
      in: z.string(),
      required: z.boolean(),
      description: z.string().optional(),
      style: z.string().optional(),
      explode: z.boolean().optional(),
      schema: z.unknown().optional(),
    }),
  ),
  requestBody: z.object({
    required: z.boolean(),
    contentTypes: z.array(z.string()),
  }),
  responses: z.unknown(),
  security: z.array(z.record(z.array(z.string()))),
});

type GetApiEndpointInput = z.infer<typeof getApiEndpointInputSchema>;
type GetApiEndpointOutput = z.infer<typeof getApiEndpointOutputSchema>;

export const getApiEndpointToolDefinition: ToolDefinition<
  GetApiEndpointInput,
  GetApiEndpointOutput
> = {
  name: 'get_api_endpoint',
  description: 'Get details for one endpoint in a specific API.',
  inputSchema: getApiEndpointInputSchema,
  outputSchema: getApiEndpointOutputSchema,
  async execute(context, input) {
    const api = requireApi(context, input.apiName);
    const endpoint = api.endpointById.get(input.endpointId);
    if (!endpoint) {
      throw new OpenApiMcpError(
        'ENDPOINT_NOT_FOUND',
        `Unknown endpoint '${input.endpointId}'`,
        {
          apiName: input.apiName,
        },
      );
    }

    const parameters = [
      ...(endpoint.pathItem.parameters ?? []),
      ...(endpoint.operation.parameters ?? []),
    ]
      .filter((item): item is OpenAPIV3.ParameterObject => !('$ref' in item))
      .map((param) => ({
        name: param.name,
        in: param.in,
        required: param.required ?? false,
        description: param.description,
        style: param.style,
        explode: param.explode,
        schema: param.schema,
      }));

    const requestContentTypes = Object.keys(
      endpoint.operation.requestBody && '$ref' in endpoint.operation.requestBody
        ? {}
        : (endpoint.operation.requestBody?.content ?? {}),
    );

    return {
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
          endpoint.operation.requestBody &&
          !('$ref' in endpoint.operation.requestBody)
            ? (endpoint.operation.requestBody.required ?? false)
            : false,
        contentTypes: requestContentTypes,
      },
      responses: endpoint.operation.responses,
      security: endpoint.operation.security ?? api.schema.security ?? [],
    };
  },
};

export async function getApiEndpointTool(
  context: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  return runMcpTool(getApiEndpointToolDefinition, context, args);
}
