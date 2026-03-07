import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { version } from '../src/mcp/server.js';

const execFileAsync = promisify(execFile);

describe('E2E MCP Server Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: 'node',
      args: [
        '--import',
        'tsx',
        'src/cli.ts',
        '--config',
        'test/fixtures/config.yaml',
      ],
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

  it('server version matches package.json', () => {
    const serverInfo = client.getServerVersion();
    expect(serverInfo?.version).toBe(version);
    expect(serverInfo?.name).toBe('openapi-mcp');
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

  it('returns error for unknown tool name', async () => {
    const result = await client.callTool({
      name: 'nonexistent_tool',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('Unknown tool'),
      },
    ]);
  });

  it('ListTools returns exactly 5 tools with correct schemas', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(5);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_api_endpoint',
      'get_api_schema',
      'list_api_endpoints',
      'list_apis',
      'make_endpoint_request',
    ]);
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
  });
});

describe('CLI flags', () => {
  it('--help exits 0 with usage text', async () => {
    const { stdout } = await execFileAsync('node', [
      '--import',
      'tsx',
      'src/cli.ts',
      '--help',
    ]);
    expect(stdout).toContain('--config');
    expect(stdout).toContain('--help');
    expect(stdout).toContain('--version');
  });

  it('--version prints the package version', async () => {
    const { stdout } = await execFileAsync('node', [
      '--import',
      'tsx',
      'src/cli.ts',
      '--version',
    ]);
    expect(stdout.trim()).toBe(version);
  });

  it('-c shorthand works as alias for --config', async () => {
    // -c with a nonexistent file should fail with CONFIG_ERROR, not "missing --config"
    try {
      await execFileAsync('node', [
        '--import',
        'tsx',
        'src/cli.ts',
        '-c',
        'nonexistent.yaml',
      ]);
    } catch (error: unknown) {
      const { stderr } = error as { stderr: string };
      expect(stderr).toContain('CONFIG_ERROR');
      return;
    }
    throw new Error('Expected command to fail');
  });

  it('missing --config exits non-zero', async () => {
    try {
      await execFileAsync('node', ['--import', 'tsx', 'src/cli.ts']);
    } catch (error: unknown) {
      const { stderr, stdout } = error as { stderr: string; stdout: string };
      const output = stdout + stderr;
      expect(output).toContain('--config');
      return;
    }
    throw new Error('Expected command to fail');
  });

  it('tool --describe matches MCP tool metadata', async () => {
    const { stdout } = await execFileAsync('node', [
      '--import',
      'tsx',
      'src/cli.ts',
      'list_apis',
      '--describe',
    ]);
    const described = JSON.parse(stdout) as {
      name: string;
      inputSchema: unknown;
      outputSchema: unknown;
    };
    expect(described.name).toBe('list_apis');
    expect(described.inputSchema).toBeDefined();
    expect(described.outputSchema).toBeDefined();
  });
});
