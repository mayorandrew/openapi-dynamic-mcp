import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '../../src/mcp/context.js';
import { getApiSchemaTool } from '../../src/mcp/tools/getApiSchema.js';
import { listApiEndpointsTool } from '../../src/mcp/tools/listApiEndpoints.js';
import { listApisTool } from '../../src/mcp/tools/listApis.js';
import { makeEndpointRequestTool } from '../../src/mcp/tools/makeEndpointRequest.js';
import { getApiEndpointTool } from '../../src/mcp/tools/getApiEndpoint.js';
import { createTestContext } from './test-utils.js';

let context: ToolContext;
const API_NAME = 'onepassconnect';

beforeEach(async () => {
  context = await createTestContext(API_NAME, `${API_NAME}.yaml`);
});

afterEach(() => {
  nock.cleanAll();
});

describe(`${API_NAME} public API tests`, () => {
  it('lists the API', async () => {
    const result = await listApisTool(context);
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        apis: [
          {
            authSchemes: ['ConnectToken'],
            baseUrl: 'http://1password.local',
            name: 'onepassconnect',
            specPath: expect.stringContaining('onepassconnect.yaml'),
            title: '1Password Connect',
            version: '1.5.7',
          },
        ],
      },
    });
  });

  it('lists api endpoints', async () => {
    const result = await listApiEndpointsTool(context, {
      apiName: API_NAME,
      limit: 10,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        endpoints: [
          {
            endpointId: 'GetApiActivity',
            method: 'get',
            operationId: 'GetApiActivity',
            path: '/activity',
            summary: 'Retrieve a list of API Requests that have been made.',
            tags: ['Activity'],
          },
          {
            endpointId: 'GetServerHealth',
            method: 'get',
            operationId: 'GetServerHealth',
            path: '/health',
            summary: 'Get state of the server and its dependencies.',
            tags: ['Health'],
          },
          {
            endpointId: 'GetHeartbeat',
            method: 'get',
            operationId: 'GetHeartbeat',
            path: '/heartbeat',
            summary: 'Ping the server for liveness',
            tags: ['Health'],
          },
          {
            endpointId: 'GetPrometheusMetrics',
            method: 'get',
            operationId: 'GetPrometheusMetrics',
            path: '/metrics',
            summary: 'Query server for exposed Prometheus metrics',
            tags: ['Metrics'],
          },
          {
            endpointId: 'GetVaults',
            method: 'get',
            operationId: 'GetVaults',
            path: '/vaults',
            summary: 'Get all Vaults',
            tags: ['Vaults'],
          },
          {
            endpointId: 'GetVaultById',
            method: 'get',
            operationId: 'GetVaultById',
            path: '/vaults/{vaultUuid}',
            summary: 'Get Vault details and metadata',
            tags: ['Vaults'],
          },
          {
            endpointId: 'GetVaultItems',
            method: 'get',
            operationId: 'GetVaultItems',
            path: '/vaults/{vaultUuid}/items',
            summary: 'Get all items for inside a Vault',
            tags: ['Items'],
          },
          {
            endpointId: 'CreateVaultItem',
            method: 'post',
            operationId: 'CreateVaultItem',
            path: '/vaults/{vaultUuid}/items',
            summary: 'Create a new Item',
            tags: ['Items'],
          },
          {
            endpointId: 'DeleteVaultItem',
            method: 'delete',
            operationId: 'DeleteVaultItem',
            path: '/vaults/{vaultUuid}/items/{itemUuid}',
            summary: 'Delete an Item',
            tags: ['Items'],
          },
          {
            endpointId: 'GetVaultItemById',
            method: 'get',
            operationId: 'GetVaultItemById',
            path: '/vaults/{vaultUuid}/items/{itemUuid}',
            summary: 'Get the details of an Item',
            tags: ['Items'],
          },
        ],
        nextCursor: '10',
      },
    });
  });

  it('gets API endpoint details', async () => {
    const endpointId = 'GetServerHealth';

    const result = await getApiEndpointTool(context, {
      apiName: API_NAME,
      endpointId,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        description: undefined,
        endpointId: 'GetServerHealth',
        method: 'get',
        operationId: 'GetServerHealth',
        parameters: [],
        path: '/health',
        requestBody: {
          contentTypes: [],
          required: false,
        },
        responses: {
          '200': {
            description: 'OK',
            content: expect.any(Object),
          },
        },
        security: [],
        summary: 'Get state of the server and its dependencies.',
        tags: ['Health'],
      },
    });
  });

  it('gets API schema', async () => {
    const result = await getApiSchemaTool(context, {
      apiName: API_NAME,
      pointer: '/info/title',
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        apiName: 'onepassconnect',
        pointer: '/info/title',
        schema: '1Password Connect',
      },
    });
  });

  it('makes endpoint request', async () => {
    const endpointId = 'GetServerHealth';
    const baseUrl = context.registry.byName.get(API_NAME)!.baseUrl;

    nock(baseUrl)
      .get('/health')
      .query(true)
      .reply(200, { success: true }, { 'content-type': 'application/json' });

    const result = await makeEndpointRequestTool(context, {
      apiName: API_NAME,
      endpointId,
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        authUsed: [],
        request: {
          endpointId: 'GetServerHealth',
          headersRedacted: {},
          method: 'GET',
          url: 'http://1password.local/health',
        },
        response: {
          bodyJson: {
            success: true,
          },
          bodyType: 'json',
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
        timingMs: expect.any(Number),
      },
    });
  });
});
