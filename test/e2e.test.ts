import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('E2E MCP Server Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/cli.ts', '--config', 'test/fixtures/config.yaml'],
    });
    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
  }, 10000); // 10s timeout for startup

  afterAll(async () => {
    try {
      await client.close();
    } catch {
      // ignore
    }
    try {
      await transport.close();
    } catch {
      // ignore
    }
  });

  it('lists expected standard tools', async () => {
    const result = await client.listTools();
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'list_api_endpoints' }),
        expect.objectContaining({ name: 'get_api_endpoint' }),
        expect.objectContaining({ name: 'get_api_schema' }),
        expect.objectContaining({ name: 'make_endpoint_request' }),
        expect.objectContaining({ name: 'list_apis' }),
      ]),
    );
  });

  it('can execute list_api_endpoints tool', async () => {
    const endpointsResult = await client.callTool({
      name: 'list_api_endpoints',
      arguments: { apiName: 'pet-api' },
    });

    expect(endpointsResult.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('get'),
      },
    ]);
  });

  it('can execute list_apis tool', async () => {
    const listApisResult = await client.callTool({
      name: 'list_apis',
      arguments: {},
    });

    expect(listApisResult.content).toEqual([
      {
        type: 'text',
        text: expect.stringMatching(
          /pet-api[\s\S]*user-api|user-api[\s\S]*pet-api/,
        ),
      },
    ]);
  });

  it('can execute get_api_endpoint tool', async () => {
    const endpointResult = await client.callTool({
      name: 'get_api_endpoint',
      arguments: { apiName: 'pet-api', endpointId: 'listPets' },
    });

    expect(endpointResult.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('/pets'),
      },
    ]);
  });

  it('can execute get_api_schema tool', async () => {
    const schemaResult = await client.callTool({
      name: 'get_api_schema',
      arguments: { apiName: 'pet-api' },
    });

    expect(schemaResult.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('openapi'),
      },
    ]);
  });
});
