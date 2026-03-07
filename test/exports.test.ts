import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';
import { OpenApiMcpError, asErrorResponse } from '../src/errors.js';
import * as toolExports from '../src/mcp/tools/index.js';

describe('errors', () => {
  it('normalizes known and unknown errors', () => {
    expect(
      asErrorResponse(
        new OpenApiMcpError('AUTH_ERROR', 'auth failed', { cause: 'boom' }),
      ),
    ).toEqual({
      code: 'AUTH_ERROR',
      message: 'auth failed',
      details: { cause: 'boom' },
    });

    expect(asErrorResponse(new Error('plain error'))).toEqual({
      code: 'REQUEST_ERROR',
      message: 'plain error',
    });

    expect(asErrorResponse('odd failure')).toEqual({
      code: 'REQUEST_ERROR',
      message: 'Unknown error',
      details: 'odd failure',
    });
  });
});

describe('public exports', () => {
  it('exports the documented top-level API', () => {
    expect(publicApi.loadConfig).toBeTypeOf('function');
    expect(publicApi.loadApiRegistry).toBeTypeOf('function');
    expect(publicApi.executeEndpointRequest).toBeTypeOf('function');
    expect(publicApi.resolveAuth).toBeTypeOf('function');
    expect(publicApi.normalizeEnvSegment).toBeTypeOf('function');
    expect(publicApi.OpenApiMcpError).toBe(OpenApiMcpError);
  });

  it('exports all MCP tool factories', () => {
    expect(toolExports.listApisTool).toBeTypeOf('function');
    expect(toolExports.listApiEndpointsTool).toBeTypeOf('function');
    expect(toolExports.getApiEndpointTool).toBeTypeOf('function');
    expect(toolExports.getApiSchemaTool).toBeTypeOf('function');
    expect(toolExports.makeEndpointRequestTool).toBeTypeOf('function');
    expect(toolExports.listApisToolDefinition.name).toBe('list_apis');
    expect(toolExports.makeEndpointRequestToolDefinition.name).toBe(
      'make_endpoint_request',
    );
  });
});
