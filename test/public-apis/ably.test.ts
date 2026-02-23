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
const API_NAME = 'ably';

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
            authSchemes: ['basicAuth', 'bearerAuth'],
            baseUrl: 'https://rest.ably.io',
            name: 'ably',
            specPath: expect.stringContaining('ably.yaml'),
            title: 'Platform API',
            version: '1.1.0',
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
            endpointId: 'getMetadataOfAllChannels',
            method: 'get',
            operationId: 'getMetadataOfAllChannels',
            path: '/channels',
            summary: 'Enumerate all active channels of the application',
            tags: ['Status'],
          },
          {
            endpointId: 'getMetadataOfChannel',
            method: 'get',
            operationId: 'getMetadataOfChannel',
            path: '/channels/{channel_id}',
            summary: 'Get metadata of a channel',
            tags: ['Status'],
          },
          {
            endpointId: 'getMessagesByChannel',
            method: 'get',
            operationId: 'getMessagesByChannel',
            path: '/channels/{channel_id}/messages',
            summary: 'Get message history for a channel',
            tags: ['History'],
          },
          {
            endpointId: 'publishMessagesToChannel',
            method: 'post',
            operationId: 'publishMessagesToChannel',
            path: '/channels/{channel_id}/messages',
            summary: 'Publish a message to a channel',
            tags: ['Publishing'],
          },
          {
            endpointId: 'getPresenceOfChannel',
            method: 'get',
            operationId: 'getPresenceOfChannel',
            path: '/channels/{channel_id}/presence',
            summary: 'Get presence of a channel',
            tags: ['Status'],
          },
          {
            endpointId: 'getPresenceHistoryOfChannel',
            method: 'get',
            operationId: 'getPresenceHistoryOfChannel',
            path: '/channels/{channel_id}/presence/history',
            summary: 'Get presence history of a channel',
            tags: ['History'],
          },
          {
            endpointId: 'requestAccessToken',
            method: 'post',
            operationId: 'requestAccessToken',
            path: '/keys/{keyName}/requestToken',
            summary: 'Request an access token',
            tags: ['Authentication'],
          },
          {
            endpointId: 'getChannelsWithPushSubscribers',
            method: 'get',
            operationId: 'getChannelsWithPushSubscribers',
            path: '/push/channels',
            summary: 'List all channels with at least one subscribed device',
            tags: ['Push'],
          },
          {
            endpointId: 'deletePushDeviceDetails',
            method: 'delete',
            operationId: 'deletePushDeviceDetails',
            path: '/push/channelSubscriptions',
            summary: "Delete a registered device's update token",
            tags: ['Push'],
          },
          {
            endpointId: 'getPushSubscriptionsOnChannels',
            method: 'get',
            operationId: 'getPushSubscriptionsOnChannels',
            path: '/push/channelSubscriptions',
            summary: 'List channel subscriptions',
            tags: ['Push'],
          },
        ],
        nextCursor: '10',
      },
    });
  });

  it('gets API endpoint details', async () => {
    const endpointId = 'getMetadataOfAllChannels';

    const result = await getApiEndpointTool(context, {
      apiName: API_NAME,
      endpointId,
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.any(String) }],
      isError: undefined,
      structuredContent: {
        description: 'Enumerate all active channels of the application',
        endpointId: 'getMetadataOfAllChannels',
        method: 'get',
        operationId: 'getMetadataOfAllChannels',
        parameters: [
          {
            description: 'The version of the API you wish to use.',
            explode: undefined,
            in: 'header',
            name: 'X-Ably-Version',
            required: false,
            schema: { type: 'string' },
            style: undefined,
          },
          {
            description: 'The response format you would like',
            explode: undefined,
            in: 'query',
            name: 'format',
            required: false,
            schema: expect.any(Object),
            style: undefined,
          },
          {
            description: undefined,
            explode: undefined,
            in: 'query',
            name: 'limit',
            required: false,
            schema: { default: 100, type: 'integer' },
            style: undefined,
          },
          {
            description:
              'Optionally limits the query to only those channels whose name starts with the given prefix',
            explode: undefined,
            in: 'query',
            name: 'prefix',
            required: false,
            schema: { type: 'string' },
            style: undefined,
          },
          {
            description:
              'optionally specifies whether to return just channel names (by=id) or ChannelDetails (by=value)',
            explode: undefined,
            in: 'query',
            name: 'by',
            required: false,
            schema: expect.any(Object),
            style: undefined,
          },
        ],
        path: '/channels',
        requestBody: {
          contentTypes: [],
          required: false,
        },
        responses: {
          '2XX': {
            description: 'OK',
            content: expect.any(Object),
            headers: expect.any(Object),
          },
          default: {
            description: 'Error',
            content: expect.any(Object),
            headers: expect.any(Object),
          },
        },
        security: [{ basicAuth: [] }, { bearerAuth: [] }],
        summary: 'Enumerate all active channels of the application',
        tags: ['Status'],
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
        apiName: 'ably',
        pointer: '/info/title',
        schema: 'Platform API',
      },
    });
  });

  it('makes endpoint request', async () => {
    const endpointId = 'getMetadataOfAllChannels';
    const baseUrl = context.registry.byName.get(API_NAME)!.baseUrl;

    nock(baseUrl)
      .get('/channels')
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
        authUsed: ['basicAuth'],
        request: {
          endpointId: 'getMetadataOfAllChannels',
          headersRedacted: {
            authorization: '<redacted>',
          },
          method: 'GET',
          url: 'https://rest.ably.io/channels',
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
