# Public API Test Guide

This directory contains fixture-backed integration tests for `openapi-dynamic-mcp` against real public OpenAPI specs.

## Purpose

These tests exist to prove that the MCP tools can handle messy real-world schemas, security definitions, server definitions, and request shapes without depending on live upstream services.

The fixtures come from public API specs, but the tests are fully local and deterministic.

## Current Pattern

Each public API gets its own test file.

Each file should:

- load exactly one local fixture from `test/public-apis/fixtures/`
- create a fresh `ToolContext` with `createTestContext(...)`
- snapshot the results of the five core tool interactions
- use `nock` for request execution tests
- hardcode the endpoint IDs used by the test instead of selecting endpoints dynamically

The standard five tests are:

1. `lists the API`
2. `lists api endpoints`
3. `gets API endpoint details`
4. `gets API schema`
5. `makes endpoint request`

## Assertions

Public API tests use exact snapshots via `toMatchSnapshot()`.

Do not write large inline `toEqual({ ... })` assertions for these files unless there is a specific reason to do so. Snapshot files are the source of truth for expected MCP output.

Use `snapshotify(...)` from [snapshot-helpers.ts](/Users/andrey.starostin/work/Experiments/openapi-mcp/test/public-apis/snapshot-helpers.ts) for request results so volatile timing fields are normalized before snapshotting.

## Request Tests

Request tests must execute a real mocked request, not `dryRun`.

The pattern is:

- pick a specific `REQUEST_ENDPOINT_ID`
- resolve the endpoint from `api.endpointById`
- call `mockEndpointRequest(...)` to prepare request inputs and install the `nock` interceptor
- call `makeEndpointRequestTool(...)`
- snapshot the normalized result

This keeps request coverage aligned with the older hand-written suites while remaining deterministic.

## Endpoint Selection

Do not search for “any usable endpoint” at runtime.

Hardcode explicit constants in each file:

- `DETAIL_ENDPOINT_ID`
- `REQUEST_ENDPOINT_ID`

If the request endpoint needs path params or a synthetic body/file payload, that is handled by `mockEndpointRequest(...)`. The test file should still declare which endpoint it is exercising.

When choosing endpoints:

- prefer stable, low-complexity operations
- prefer endpoints that do not require custom query/header setup beyond auth
- for request tests, prefer endpoints that can be mocked with the helper’s generated path params and minimal body/files

If one endpoint is best for metadata and another is best for execution, use different constants.

## Helpers

Two helper files support these tests:

- [test-utils.ts](/Users/andrey.starostin/work/Experiments/openapi-mcp/test/public-apis/test-utils.ts)
- [snapshot-helpers.ts](/Users/andrey.starostin/work/Experiments/openapi-mcp/test/public-apis/snapshot-helpers.ts)

`test-utils.ts` is responsible for:

- loading the fixture-backed registry
- creating the `ToolContext`
- injecting dummy auth env vars for every discovered auth scheme

`snapshot-helpers.ts` is responsible for:

- generating placeholder path params
- normalizing snapshot timing fields
- preparing minimal request bodies/files/content types when needed
- installing the `nock` interceptor for the chosen endpoint

Do not re-copy those helpers into individual test files.

## Nock Usage

Every file that calls `makeEndpointRequestTool(...)` should:

- import `nock`
- clean mocks in `afterEach(() => nock.cleanAll())`

Do not make live network requests from these tests.

## Fixtures

Fixture files live in `test/public-apis/fixtures/`.

Rules:

- keep fixtures local in the repo
- do not fetch specs during test execution
- prefer checked-in `.yaml` fixtures matching the public API name

If you add a new public API test:

1. add the fixture
2. add a dedicated `<api>.test.ts`
3. use the same five-test pattern
4. hardcode explicit endpoint IDs
5. generate snapshots with Vitest

## Snapshot Workflow

When behavior changes intentionally, update snapshots with:

```bash
npx vitest run test/public-apis/<api>.test.ts -u
```

For broad public API updates:

```bash
npx vitest run test/public-apis/*.test.ts -u
```

Then run the full suite:

```bash
npm test
```

## What To Avoid

Avoid these patterns in this directory:

- dynamic endpoint discovery for assertions
- `dryRun` request tests
- live HTTP requests
- duplicated local helper functions
- partial assertions when a full snapshot is appropriate
- remote spec downloads during tests

## File Shape

A typical file should look like this:

- imports
- `API_NAME`
- `SPEC_FILE`
- `DETAIL_ENDPOINT_ID`
- `REQUEST_ENDPOINT_ID`
- `beforeEach`
- `afterEach`
- five snapshot tests

Keep the files simple and explicit. The goal here is coverage over a broad set of real specs, not abstraction for its own sake.
