import type { ToolDefinition } from './common.js';
import {
  getApiEndpointToolDefinition,
  getApiSchemaToolDefinition,
  listApiEndpointsToolDefinition,
  listApisToolDefinition,
  makeEndpointRequestToolDefinition,
} from './index.js';

export const toolDefinitions: ToolDefinition<{ fields?: string[] }, unknown>[] =
  [
    listApisToolDefinition,
    listApiEndpointsToolDefinition,
    getApiEndpointToolDefinition,
    getApiSchemaToolDefinition,
    makeEndpointRequestToolDefinition,
  ];

export function getToolDefinition(name: string) {
  return toolDefinitions.find((tool) => tool.name === name);
}
