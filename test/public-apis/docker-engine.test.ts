import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '../../src/mcp/context.js';
import { getApiEndpointTool } from '../../src/mcp/tools/getApiEndpoint.js';
import { getApiSchemaTool } from '../../src/mcp/tools/getApiSchema.js';
import { listApiEndpointsTool } from '../../src/mcp/tools/listApiEndpoints.js';
import { listApisTool } from '../../src/mcp/tools/listApis.js';
import { makeEndpointRequestTool } from '../../src/mcp/tools/makeEndpointRequest.js';
import { mockEndpointRequest, snapshotify } from './snapshot-helpers.js';
import { createTestContext } from './test-utils.js';

let context: ToolContext;
const API_NAME = 'docker-engine';
const SPEC_FILE = 'docker-engine.yaml';
const DETAIL_ENDPOINT_ID = 'SystemPing';
const REQUEST_ENDPOINT_ID = 'SystemPing';
beforeEach(async () => {
  context = await createTestContext(API_NAME, SPEC_FILE);
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
      await listApiEndpointsTool(context, { apiName: API_NAME, limit: 3 }),
    ).toMatchSnapshot();
  });
  it('gets API endpoint details', async () => {
    expect(
      await getApiEndpointTool(context, {
        apiName: API_NAME,
        endpointId: DETAIL_ENDPOINT_ID,
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
    const api = context.registry.byName.get(API_NAME)!;
    const endpoint = api.endpointById.get(REQUEST_ENDPOINT_ID)!;
    const request = await mockEndpointRequest(context, api, endpoint);
    expect(
      snapshotify(
        await makeEndpointRequestTool(context, {
          apiName: API_NAME,
          endpointId: request.endpointId,
          pathParams: request.pathParams,
          body: request.body,
          files: request.files,
          contentType: request.contentType,
        }),
      ),
    ).toMatchSnapshot();
  });
});
