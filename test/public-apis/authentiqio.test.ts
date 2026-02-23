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
const API_NAME = 'authentiqio';

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
            authSchemes: [],
            baseUrl: 'https://6-dot-authentiqio.appspot.com',
            name: 'authentiqio',
            specPath: expect.stringContaining('authentiqio.yaml'),
            title: 'Authentiq API',
            version: '6',
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
            endpointId: 'key_revoke_nosecret',
            method: 'delete',
            operationId: 'key_revoke_nosecret',
            path: '/key',
            summary: undefined,
            tags: ['key', 'delete'],
          },
          {
            endpointId: 'key_register',
            method: 'post',
            operationId: 'key_register',
            path: '/key',
            summary: undefined,
            tags: ['key', 'post'],
          },
          {
            endpointId: 'key_revoke',
            method: 'delete',
            operationId: 'key_revoke',
            path: '/key/{PK}',
            summary: undefined,
            tags: ['key', 'delete'],
          },
          {
            endpointId: 'key_retrieve',
            method: 'get',
            operationId: 'key_retrieve',
            path: '/key/{PK}',
            summary: undefined,
            tags: ['key', 'get'],
          },
          {
            endpointId: 'HEAD /key/{PK}',
            method: 'head',
            operationId: undefined,
            path: '/key/{PK}',
            summary: undefined,
            tags: ['key', 'head'],
          },
          {
            endpointId: 'key_update',
            method: 'post',
            operationId: 'key_update',
            path: '/key/{PK}',
            summary: undefined,
            tags: ['key', 'post'],
          },
          {
            endpointId: 'key_bind',
            method: 'put',
            operationId: 'key_bind',
            path: '/key/{PK}',
            summary: undefined,
            tags: ['key', 'put'],
          },
          {
            endpointId: 'push_login_request',
            method: 'post',
            operationId: 'push_login_request',
            path: '/login',
            summary: undefined,
            tags: ['login', 'post'],
          },
          {
            endpointId: 'sign_request',
            method: 'post',
            operationId: 'sign_request',
            path: '/scope',
            summary: undefined,
            tags: ['scope', 'post'],
          },
          {
            endpointId: 'sign_delete',
            method: 'delete',
            operationId: 'sign_delete',
            path: '/scope/{job}',
            summary: undefined,
            tags: ['scope', 'delete'],
          },
        ],
        nextCursor: '10',
      },
    });
  });

  it('gets API endpoint details', async () => {
    const endpointId = 'key_retrieve';

    const result = await getApiEndpointTool(context, {
      apiName: API_NAME,
      endpointId,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        description: 'Get public details of an Authentiq ID.\n',
        endpointId: 'key_retrieve',
        method: 'get',
        operationId: 'key_retrieve',
        parameters: [
          {
            description: 'Public Signing Key - Authentiq ID (43 chars)',
            explode: undefined,
            in: 'path',
            name: 'PK',
            required: true,
            schema: { type: 'string' },
            style: undefined,
          },
        ],
        path: '/key/{PK}',
        requestBody: {
          contentTypes: [],
          required: false,
        },
        responses: {
          '200': {
            description: 'Successfully retrieved',
            content: expect.any(Object),
          },
          '404': {
            description: 'Unknown key `unknown-key`',
            content: expect.any(Object),
          },
          '410': {
            description: 'Key is revoked (gone). `revoked-key`',
            content: expect.any(Object),
          },
          default: {
            description: 'Error response',
            content: expect.any(Object),
          },
        },
        security: [],
        summary: undefined,
        tags: ['key', 'get'],
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
        apiName: 'authentiqio',
        pointer: '/info/title',
        schema: 'Authentiq API',
      },
    });
  });

  it('makes endpoint request', async () => {
    const endpointId = 'key_retrieve';
    const baseUrl = context.registry.byName.get(API_NAME)!.baseUrl;

    nock(baseUrl)
      .get('/key/test_val')
      .query(true)
      .reply(200, { success: true }, { 'content-type': 'application/json' });

    const result = await makeEndpointRequestTool(context, {
      apiName: API_NAME,
      endpointId,
      pathParams: { PK: 'test_val' },
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        authUsed: [],
        request: {
          endpointId: 'key_retrieve',
          headersRedacted: {},
          method: 'GET',
          url: 'https://6-dot-authentiqio.appspot.com/key/test_val',
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
