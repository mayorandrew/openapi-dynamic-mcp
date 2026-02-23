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
const API_NAME = 'oneforge';

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
            baseUrl: 'https://1forge.com/forex-quotes',
            name: 'oneforge',
            specPath: expect.stringContaining('oneforge.yaml'),
            title: '1Forge Finance APIs',
            version: '0.0.1',
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
            endpointId: 'GET /quotes',
            method: 'get',
            operationId: undefined,
            path: '/quotes',
            summary: 'Get quotes for all symbols',
            tags: ['forex', 'finance', 'quotes'],
          },
          {
            endpointId: 'GET /symbols',
            method: 'get',
            operationId: undefined,
            path: '/symbols',
            summary:
              'Get a list of symbols for which we provide real-time quotes',
            tags: ['forex', 'finance', 'quotes'],
          },
        ],
        nextCursor: undefined,
      },
    });
  });

  it('gets API endpoint details', async () => {
    const endpointId = 'GET /quotes';

    const result = await getApiEndpointTool(context, {
      apiName: API_NAME,
      endpointId,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        description: 'Get quotes',
        endpointId: 'GET /quotes',
        method: 'get',
        operationId: undefined,
        parameters: [],
        path: '/quotes',
        requestBody: {
          contentTypes: [],
          required: false,
        },
        responses: {
          '200': {
            description: 'A list of quotes',
          },
        },
        security: [],
        summary: 'Get quotes for all symbols',
        tags: ['forex', 'finance', 'quotes'],
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
        apiName: 'oneforge',
        pointer: '/info/title',
        schema: '1Forge Finance APIs',
      },
    });
  });

  it('makes endpoint request', async () => {
    const endpointId = 'GET /quotes';
    const baseUrl = context.registry.byName.get(API_NAME)!.baseUrl;

    nock(baseUrl)
      .get('/quotes')
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
          endpointId: 'GET /quotes',
          headersRedacted: {},
          method: 'GET',
          url: 'https://1forge.com/forex-quotes/quotes',
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
