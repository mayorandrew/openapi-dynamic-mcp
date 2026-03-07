import {
  executeToolData,
  toToolDescriptor,
  type ToolDefinition,
} from './common.js';
import type { ToolContext } from '../context.js';
import {
  getApiEndpointToolDefinition,
  getApiSchemaToolDefinition,
  listApiEndpointsToolDefinition,
  listApisToolDefinition,
  makeEndpointRequestToolDefinition,
} from './index.js';

export interface RegisteredTool {
  name: string;
  description: string;
  descriptor: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
  };
  execute: (context: ToolContext, args: unknown) => Promise<unknown>;
}

function registerTool<TInput extends { fields?: string[] }, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
): RegisteredTool {
  return {
    name: definition.name,
    description: definition.description,
    descriptor: toToolDescriptor(definition),
    execute: (context, args) => executeToolData(definition, context, args),
  };
}

export const toolDefinitions: RegisteredTool[] = [
  registerTool(listApisToolDefinition),
  registerTool(listApiEndpointsToolDefinition),
  registerTool(getApiEndpointToolDefinition),
  registerTool(getApiSchemaToolDefinition),
  registerTool(makeEndpointRequestToolDefinition),
];

export function getToolDefinition(name: string): RegisteredTool | undefined {
  return toolDefinitions.find((tool) => tool.name === name);
}
