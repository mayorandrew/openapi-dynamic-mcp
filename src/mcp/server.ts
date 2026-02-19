import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './context.js';
import {
  getApiEndpointTool,
  getApiSchemaTool,
  listApiEndpointsTool,
  listApisTool,
  makeEndpointRequestTool,
} from './tools/index.js';
import { fail } from './tools/common.js';

const TOOLS = [
  {
    name: 'list_apis',
    description: 'List configured APIs loaded from the YAML configuration.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_api_endpoints',
    description: 'List endpoints from a specific API with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        apiName: { type: 'string' },
        method: { type: 'string' },
        tag: { type: 'string' },
        pathContains: { type: 'string' },
        search: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1 },
        cursor: { type: 'string' },
      },
      required: ['apiName'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_api_endpoint',
    description: 'Get details for one endpoint in a specific API.',
    inputSchema: {
      type: 'object',
      properties: {
        apiName: { type: 'string' },
        endpointId: { type: 'string' },
      },
      required: ['apiName', 'endpointId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_api_schema',
    description:
      'Get the full dereferenced API schema or a JSON pointer fragment.',
    inputSchema: {
      type: 'object',
      properties: {
        apiName: { type: 'string' },
        pointer: { type: 'string' },
      },
      required: ['apiName'],
      additionalProperties: false,
    },
  },
  {
    name: 'make_endpoint_request',
    description: 'Execute an HTTP request for an endpoint by endpointId.',
    inputSchema: {
      type: 'object',
      properties: {
        apiName: { type: 'string' },
        endpointId: { type: 'string' },
        pathParams: { type: 'object' },
        query: { type: 'object' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        cookies: { type: 'object', additionalProperties: { type: 'string' } },
        body: {},
        contentType: { type: 'string' },
        accept: { type: 'string' },
        timeoutMs: { type: 'integer', minimum: 1 },
        retry429: {
          type: 'object',
          properties: {
            maxRetries: { type: 'integer', minimum: 0 },
            baseDelayMs: { type: 'integer', minimum: 1 },
            maxDelayMs: { type: 'integer', minimum: 1 },
            jitterRatio: { type: 'number', minimum: 0, maximum: 1 },
            respectRetryAfter: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      required: ['apiName', 'endpointId'],
      additionalProperties: false,
    },
  },
] as const;

export async function startMcpServer(context: ToolContext): Promise<void> {
  const server = new Server(
    {
      name: 'openapi-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [...TOOLS] };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<any> => {
      const toolName = request.params.name;
      const args = request.params.arguments ?? {};

      switch (toolName) {
        case 'list_apis':
          return listApisTool(context);
        case 'list_api_endpoints':
          return listApiEndpointsTool(context, args);
        case 'get_api_endpoint':
          return getApiEndpointTool(context, args);
        case 'get_api_schema':
          return getApiSchemaTool(context, args);
        case 'make_endpoint_request':
          return makeEndpointRequestTool(context, args);
        default:
          return fail(new Error(`Unknown tool: ${toolName}`));
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
