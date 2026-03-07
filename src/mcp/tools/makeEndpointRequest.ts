import {
  executeEndpointRequest,
  prepareEndpointRequest,
} from '../../http/requestExecutor.js';
import { OpenApiMcpError } from '../../errors.js';
import type { ToolContext } from '../context.js';
import { z } from 'zod';
import {
  requireApi,
  runMcpTool,
  toStringMap,
  withFields,
  type ToolDefinition,
  type ToolResult,
} from './common.js';

const fileDescriptorSchema = z
  .object({
    name: z.string().optional(),
    contentType: z.string().optional(),
    base64: z.string().optional(),
    text: z.string().optional(),
    filePath: z.string().optional(),
  })
  .strict();

const makeEndpointRequestInputSchema = withFields(
  z
    .object({
      apiName: z.string().min(1),
      endpointId: z.string().min(1),
      pathParams: z.record(z.unknown()).nullable().optional(),
      query: z.record(z.unknown()).nullable().optional(),
      headers: z.record(z.unknown()).nullable().optional(),
      cookies: z.record(z.unknown()).nullable().optional(),
      body: z.unknown().optional(),
      files: z.record(fileDescriptorSchema).optional(),
      contentType: z.string().optional(),
      accept: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
      maxRetries429: z.number().int().nonnegative().optional(),
      dryRun: z.boolean().optional(),
    })
    .strict(),
);

const requestBodyPreviewSchema = z.union([
  z.object({ bodyType: z.literal('empty') }),
  z.object({ bodyType: z.literal('json'), bodyJson: z.unknown() }),
  z.object({ bodyType: z.literal('text'), bodyText: z.string() }),
  z.object({
    bodyType: z.literal('binary'),
    bodyBase64: z.string().optional(),
  }),
  z.object({
    bodyType: z.literal('form-data'),
    fields: z.array(
      z.object({
        name: z.string(),
        valueType: z.enum(['text', 'json', 'file']),
        valueText: z.string().optional(),
        valueJson: z.unknown().optional(),
        fileName: z.string().optional(),
        contentType: z.string().optional(),
        sizeBytes: z.number().optional(),
      }),
    ),
  }),
]);

const requestSchema = z.object({
  url: z.string(),
  method: z.string(),
  headersRedacted: z.record(z.string()),
  endpointId: z.string(),
});

const responseSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string()),
  bodyType: z.enum(['json', 'text', 'binary', 'empty']),
  bodyJson: z.unknown().optional(),
  bodyText: z.string().optional(),
  bodyBase64: z.string().optional(),
});

const makeEndpointRequestOutputSchema = z.object({
  request: requestSchema,
  requestBodyPreview: requestBodyPreviewSchema.optional(),
  response: responseSchema.optional(),
  timingMs: z.number(),
  authUsed: z.array(z.string()),
  dryRun: z.literal(true).optional(),
});

type MakeEndpointRequestInput = z.infer<typeof makeEndpointRequestInputSchema>;
type MakeEndpointRequestOutput = z.infer<
  typeof makeEndpointRequestOutputSchema
>;

export const makeEndpointRequestToolDefinition: ToolDefinition<
  MakeEndpointRequestInput,
  MakeEndpointRequestOutput
> = {
  name: 'make_endpoint_request',
  description: 'Execute an HTTP request for an endpoint by endpointId.',
  inputSchema: makeEndpointRequestInputSchema,
  outputSchema: makeEndpointRequestOutputSchema,
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

    const executorInput = {
      api,
      endpoint,
      pathParams: input.pathParams ?? {},
      query: input.query ?? {},
      headers: toStringMap(input.headers),
      cookies: toStringMap(input.cookies),
      body: input.body,
      files: input.files as
        | Record<string, import('../../types.js').McpFileDescriptor>
        | undefined,
      contentType: input.contentType,
      accept: input.accept,
      timeoutMs: input.timeoutMs,
      retry429:
        input.maxRetries429 !== undefined
          ? { maxRetries: input.maxRetries429 }
          : undefined,
      oauthClient: context.oauthClient,
      authStore: context.authStore,
      env: context.env,
    };

    if (input.dryRun) {
      const prepared = await prepareEndpointRequest(executorInput);
      if ('response' in prepared) {
        return {
          request: prepared.request,
          response: prepared.response,
          timingMs: prepared.timingMs,
          authUsed: prepared.authUsed,
        };
      }
      return {
        dryRun: true,
        request: prepared.request,
        requestBodyPreview: prepared.requestBodyPreview,
        timingMs: prepared.timingMs,
        authUsed: prepared.authUsed,
      };
    }

    return executeEndpointRequest(executorInput);
  },
};

export async function makeEndpointRequestTool(
  context: ToolContext,
  args: unknown,
): Promise<ToolResult> {
  return runMcpTool(makeEndpointRequestToolDefinition, context, args);
}
