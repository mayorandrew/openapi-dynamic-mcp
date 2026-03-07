import type { ToolDefinition } from './common.js';
import {
  getApiEndpointToolDefinition,
  getApiSchemaToolDefinition,
  listApiEndpointsToolDefinition,
  listApisToolDefinition,
  makeEndpointRequestToolDefinition,
} from './index.js';

type AnyToolDefinition = ToolDefinition<any, unknown>;

export const toolDefinitions: AnyToolDefinition[] = [
  listApisToolDefinition,
  listApiEndpointsToolDefinition,
  getApiEndpointToolDefinition,
  getApiSchemaToolDefinition,
  makeEndpointRequestToolDefinition,
];

export function getToolDefinition(name: string): AnyToolDefinition | undefined {
  return toolDefinitions.find((tool) => tool.name === name);
}
