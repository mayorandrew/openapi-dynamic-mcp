import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './context.js';
import { fail, toToolDescriptor } from './tools/common.js';
import { getToolDefinition, toolDefinitions } from './tools/registry.js';
import { executeToolData } from './tools/common.js';

const require = createRequire(import.meta.url);
export const { version } = require('../../package.json') as {
  version: string;
};

export async function startMcpServer(context: ToolContext): Promise<void> {
  const server = new Server(
    {
      name: 'openapi-mcp',
      version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions.map((tool) => toToolDescriptor(tool)) };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (request): Promise<any> => {
      const toolName = request.params.name;
      const args = request.params.arguments ?? {};
      const definition = getToolDefinition(toolName);
      if (!definition) {
        return fail(new Error(`Unknown tool: ${toolName}`));
      }

      try {
        const payload = await executeToolData(definition, context, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(payload, null, 2),
            },
          ],
          structuredContent: payload,
        };
      } catch (error) {
        return fail(error);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
