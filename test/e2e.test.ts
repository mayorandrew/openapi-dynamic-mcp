import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { version } from '../src/mcp/server.js';

const execFileAsync = promisify(execFile);
const cliEntrypoint = ['--import', 'tsx', 'src/cli.ts'];
const configPath = 'test/fixtures/config.yaml';

async function runCli(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('node', [...cliEntrypoint, ...args], {
    env: { ...process.env, ...options?.env },
  });
}

describe('E2E MCP Server Test', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: 'node',
      args: [...cliEntrypoint, '--config', configPath],
    });
    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
  }, 10000);

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

describe('Serve subcommand', () => {
  it('starts the MCP server via explicit serve subcommand', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [...cliEntrypoint, 'serve', '--config', configPath],
    });
    const client = new Client(
      { name: 'serve-test-client', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      const result = await client.listTools();
      expect(result.tools).toHaveLength(5);
    } finally {
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
    }
  }, 10000);
});

describe('CLI flags', () => {
  it('--help exits 0 with usage text', async () => {
    const { stdout } = await runCli(['--help']);
    expect(stdout).toContain('--config');
    expect(stdout).toContain('--help');
    expect(stdout).toContain('--version');
  });

  it('--version prints the package version', async () => {
    const { stdout } = await runCli(['--version']);
    expect(stdout.trim()).toBe(version);
  });

  it('-c shorthand works as alias for --config', async () => {
    try {
      await runCli(['-c', 'nonexistent.yaml']);
    } catch (error: unknown) {
      const { stderr } = error as { stderr: string };
      expect(stderr).toContain('CONFIG_ERROR');
      return;
    }
    throw new Error('Expected command to fail');
  });

  it('missing --config exits non-zero', async () => {
    try {
      await runCli([]);
    } catch (error: unknown) {
      const { stderr, stdout } = error as { stderr: string; stdout: string };
      const output = stdout + stderr;
      expect(output).toContain('--config');
      return;
    }
    throw new Error('Expected command to fail');
  });

  it('tool --describe matches MCP tool metadata', async () => {
    const { stdout } = await runCli(['list_apis', '--describe']);
    const described = JSON.parse(stdout) as {
      name: string;
      inputSchema: unknown;
      outputSchema: unknown;
    };
    expect(described.name).toBe('list_apis');
    expect(described.inputSchema).toBeDefined();
    expect(described.outputSchema).toBeDefined();
  });

  it('auth --describe prints the auth command schema', async () => {
    const { stdout } = await runCli(['auth', '--describe']);
    const described = JSON.parse(stdout) as {
      name: string;
      inputSchema: { properties?: Record<string, unknown> };
      outputSchema: { properties?: Record<string, unknown> };
    };

    expect(described.name).toBe('auth');
    expect(described.inputSchema.properties?.api).toBeDefined();
    expect(described.outputSchema.properties?.authFile).toBeDefined();
  });
});

describe('CLI command behavior', () => {
  it('executes tool commands with --input JSON', async () => {
    const { stdout } = await runCli([
      'list_api_endpoints',
      '--config',
      configPath,
      '--input',
      '{"apiName":"pet-api","limit":1}',
    ]);
    const payload = JSON.parse(stdout) as {
      endpoints: Array<{ endpointId: string }>;
    };

    expect(payload.endpoints).toHaveLength(1);
    expect(payload.endpoints[0]?.endpointId).toBe('authCodeEndpoint');
  });

  it('supports --fields filtering for tool command output', async () => {
    const { stdout } = await runCli([
      'list_apis',
      '--config',
      configPath,
      '--fields',
      '$.apis[*].name',
      '--input',
      '{}',
    ]);
    expect(JSON.parse(stdout)).toEqual({
      apis: [{ name: 'pet-api' }, { name: 'user-api' }],
    });
  });

  it('renders OpenApiMcpError for invalid JSON input with non-zero exit', async () => {
    try {
      await runCli([
        'list_apis',
        '--config',
        configPath,
        '--input',
        '{not-json}',
      ]);
    } catch (error: unknown) {
      const failure = error as { code?: number; stderr: string };
      expect(failure.code).not.toBe(0);
      expect(JSON.parse(failure.stderr)).toMatchObject({
        code: 'REQUEST_ERROR',
        message: 'Invalid JSON input',
      });
      return;
    }
    throw new Error('Expected command to fail');
  });

  it('fails auth command when required identifiers are missing', async () => {
    try {
      await runCli(['auth', '--config', configPath]);
    } catch (error: unknown) {
      const failure = error as { stderr: string };
      expect(JSON.parse(failure.stderr)).toMatchObject({
        code: 'CONFIG_ERROR',
        message: 'Missing required --api or --scheme',
      });
      return;
    }
    throw new Error('Expected command to fail');
  });

  it('fails auth command for unknown APIs', async () => {
    try {
      await runCli([
        'auth',
        '--config',
        configPath,
        '--api',
        'missing-api',
        '--scheme',
        'BearerAuth',
        '--token',
        'token-1',
      ]);
    } catch (error: unknown) {
      const failure = error as { stderr: string };
      expect(JSON.parse(failure.stderr)).toMatchObject({
        code: 'API_NOT_FOUND',
        message: "Unknown API 'missing-api'",
      });
      return;
    }
    throw new Error('Expected command to fail');
  });

  it('persists bearer auth tokens via the auth command', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'openapi-mcp-auth-'));
    const authFile = path.join(tempDir, 'auth.json');

    try {
      const { stdout } = await runCli([
        'auth',
        '--config',
        configPath,
        '--api',
        'pet-api',
        '--scheme',
        'BearerAuth',
        '--token',
        'stored-token',
        '--auth-file',
        authFile,
      ]);

      const payload = JSON.parse(stdout) as {
        stored: boolean;
        kind: string;
        apiName: string;
        schemeName: string;
        authFile: string;
      };
      expect(payload).toMatchObject({
        stored: true,
        kind: 'http-bearer',
        apiName: 'pet-api',
        schemeName: 'BearerAuth',
        authFile,
      });

      const storedFile = JSON.parse(await readFile(authFile, 'utf8')) as {
        entries: Record<string, { token?: string; kind: string }>;
      };
      expect(storedFile.entries.PET_API_BEARERAUTH).toMatchObject({
        kind: 'http-bearer',
        token: 'stored-token',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
