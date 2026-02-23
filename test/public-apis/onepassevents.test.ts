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
const API_NAME = 'onepassevents';

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
            authSchemes: ['jwtsa'],
            baseUrl: 'https://events.1password.com',
            name: 'onepassevents',
            specPath: expect.stringContaining('onepassevents.yaml'),
            title: 'Events API',
            version: '1.0.0',
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
            endpointId: 'getAuthIntrospect',
            method: 'get',
            operationId: 'getAuthIntrospect',
            path: '/api/auth/introspect',
            summary: 'Performs introspection of the provided Bearer JWT token',
            tags: ['auth'],
          },
          {
            endpointId: 'getItemUsages',
            method: 'post',
            operationId: 'getItemUsages',
            path: '/api/v1/itemusages',
            summary: 'Retrieves item usages',
            tags: ['api-v1'],
          },
          {
            endpointId: 'getSignInAttempts',
            method: 'post',
            operationId: 'getSignInAttempts',
            path: '/api/v1/signinattempts',
            summary: 'Retrieves sign-in attempts',
            tags: ['api-v1'],
          },
        ],
        nextCursor: undefined,
      },
    });
  });

  it('gets API endpoint details', async () => {
    const endpointId = 'getAuthIntrospect';

    const result = await getApiEndpointTool(context, {
      apiName: API_NAME,
      endpointId,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        description: undefined,
        endpointId: 'getAuthIntrospect',
        method: 'get',
        operationId: 'getAuthIntrospect',
        parameters: [],
        path: '/api/auth/introspect',
        requestBody: {
          contentTypes: [],
          required: false,
        },
        responses: {
          '200': {
            description: 'Introspection object',
            content: expect.any(Object),
          },
          '401': {
            description: 'Unauthorized',
            content: expect.any(Object),
          },
          default: {
            description: 'Generic error',
            content: expect.any(Object),
          },
        },
        security: [{ jwtsa: [] }],
        summary: 'Performs introspection of the provided Bearer JWT token',
        tags: ['auth'],
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
        apiName: 'onepassevents',
        pointer: '/info/title',
        schema: 'Events API',
      },
    });
  });

  it('makes endpoint request', async () => {
    const endpointId = 'getAuthIntrospect';
    const baseUrl = context.registry.byName.get(API_NAME)!.baseUrl;

    nock(baseUrl)
      .get('/api/auth/introspect')
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
        authUsed: ['jwtsa'],
        request: {
          endpointId: 'getAuthIntrospect',
          headersRedacted: {
            authorization: '<redacted>',
          },
          method: 'GET',
          url: 'https://events.1password.com/api/auth/introspect',
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
