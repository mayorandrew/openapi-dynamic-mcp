import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('E2E MCP Server Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/cli.ts', '--config', 'test-apis.yaml'],
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
    expect(result.tools).toBeDefined();

    const toolNames = result.tools.map((t) => t.name);
    // Ensure standard dynamically generated tools are present
    expect(toolNames).toContain('list_api_endpoints');
    expect(toolNames).toContain('get_api_endpoint');
    expect(toolNames).toContain('get_api_schema');
    expect(toolNames).toContain('make_endpoint_request');
    expect(toolNames).toContain('list_apis');
  });

  it('can execute list_api_endpoints tool', async () => {
    const endpointsResult = await client.callTool({
      name: 'list_api_endpoints',
      arguments: { apiName: 'oneforge' }, // oneforge is in test-apis.yaml
    });

    const content = endpointsResult.content as Array<{
      type: string;
      text?: string;
    }>;

    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);
    expect(content[0].type).toBe('text');

    const textContent = content[0].text;
    expect(typeof textContent).toBe('string');
    if (textContent) {
      expect(textContent.length).toBeGreaterThan(0);
      // Verify it lists some sensible HTTP methods
      expect(textContent).toContain('GET');
    }
  });
});
