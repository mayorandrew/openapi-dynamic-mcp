import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '../../src/mcp/context.js';
import { getApiEndpointTool } from '../../src/mcp/tools/getApiEndpoint.js';
import { getApiSchemaTool } from '../../src/mcp/tools/getApiSchema.js';
import { listApiEndpointsTool } from '../../src/mcp/tools/listApiEndpoints.js';
import { listApisTool } from '../../src/mcp/tools/listApis.js';
import { makeEndpointRequestTool } from '../../src/mcp/tools/makeEndpointRequest.js';
import { snapshotify } from './snapshot-helpers.js';
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
    expect(await listApisTool(context)).toMatchSnapshot();
  });

  it('lists api endpoints', async () => {
    expect(
      await listApiEndpointsTool(context, {
        apiName: API_NAME,
        limit: 10,
      }),
    ).toMatchSnapshot();
  });

  it('gets API endpoint details', async () => {
    expect(
      await getApiEndpointTool(context, {
        apiName: API_NAME,
        endpointId: 'key_retrieve',
      }),
    ).toMatchSnapshot();
  });

  it('gets API schema', async () => {
    expect(
      await getApiSchemaTool(context, {
        apiName: API_NAME,
        pointer: '/info/title',
      }),
    ).toMatchSnapshot();
  });

  it('makes endpoint request', async () => {
    const endpointId = 'key_retrieve';
    const baseUrl = context.registry.byName.get(API_NAME)!.baseUrl;

    nock(baseUrl)
      .get('/key/test_val')
      .query(true)
      .reply(200, { success: true }, { 'content-type': 'application/json' });

    expect(
      snapshotify(
        await makeEndpointRequestTool(context, {
          apiName: API_NAME,
          endpointId,
          pathParams: { PK: 'test_val' },
        }),
      ),
    ).toMatchSnapshot();
  });
});
