# Testing OpenAPI MCP with Real Public APIs

This directory contains integration-style unit tests that verify the `openapi-dynamic-mcp` tools against real-world, public OpenAPI specifications.

## The Approach

To ensure our MCP server can handle the complexity and variety of real-world OpenAPI specifications, we test it against a curated list of public APIs (sourced from APIs.guru).

The testing strategy follows these core principles:

1. **Local Fixtures for Stability**:
   Instead of fetching OpenAPI specifications from remote URLs during tests (which can cause flaky tests due to network issues), we download the `.yaml` specification files and store them locally in `test/public-apis/fixtures/`.

2. **Self-Contained Test Context**:
   The `test-utils.ts` file provides a `createTestContext` helper. This helper initializes the `ToolContext` using the local fixture files, bypassing the need for a live `test-apis.yaml` or remote `specUrl` resolution.

3. **Bypassing Authentication Validation**:
   Many real-world APIs require authentication (API Keys, Bearer tokens, OAuth2). The MCP server's `make_endpoint_request` tool validates these requirements _before_ executing a request. To test the request execution logic without needing real credentials, `test-utils.ts` inspects the loaded API's security schemes and automatically injects appropriate dummy credentials (e.g., `DUMMY_KEY`, `DUMMY_TOKEN`) into the test environment.

4. **Mocking HTTP Requests with Nock**:
   We do not want to execute real HTTP requests to these public APIs during testing. Instead, we use `nock` to intercept the outgoing request just before it leaves the Node.js environment. We configure `nock` to intercept the specific HTTP method and base URL defined by the API specification, and return a mock `200 Success` response.

5. **Deterministic Assertions (Object Matching)**:
   Because we inject dummy credentials and use `nock` to return successful responses, our tests should always follow the "happy path". We expect `result.isError` to be undefined, and we explicitly assert the entire response object using `expect(result).toEqual({ ... })`. We avoid conditional assertions (`if (result.isError) { ... } else { ... }`) and piecemeal checks to ensure our tests are deterministic and strictly validate the complete expected behavior. For fields that are non-deterministic (like `timingMs`), we use matchers like `expect.any(Number)`.

## Test File Anatomy

Each test file in this directory (e.g., `ably.test.ts`, `oneforge.test.ts`) is designed to test one specific public API against all 5 core MCP tools:

- `listApisTool`: Verifies the API registers successfully.
- `listApiEndpointsTool`: Verifies the server can discover and list the API's endpoints.
- `getApiEndpointTool`: Verifies the server can correctly extract method and path details for a specific endpoint.
- `getApiSchemaTool`: Verifies the server can resolve JSON pointers within the API's schema.
- `makeEndpointRequestTool`: Verifies the server can construct and execute (mocked) HTTP requests, correctly handling parameters and authentication.
