# openapi-dynamic-mcp

TypeScript MCP stdio server that loads one or more OpenAPI 3.x specs from YAML config and exposes generic tools for API discovery and request execution.

## What It Does

- Runs as a single MCP stdio server for multiple APIs.
- Supports OpenAPI `3.x` local spec files.
- Exposes generic MCP tools:
  - `list_apis`
  - `list_api_endpoints`
  - `get_api_endpoint`
  - `get_api_schema`
  - `make_endpoint_request`
- Supports auth:
  - `apiKey`
  - OAuth2 client credentials (`oauth2`)
  - combined OpenAPI security requirements (AND inside object, OR across array)
- Supports per-API environment overrides for:
  - base URL
  - extra headers

## Requirements

- Node.js `20+`

## Quick Start

```bash
npx openapi-dynamic-mcp --config ./examples/config.yaml
```

If installed as a package, the CLI binary is `openapi-dynamic-mcp`.

## Configuration

```yaml
version: 1
apis:
  - name: pet-api
    specPath: ./pet-api.yaml
    baseUrl: https://api.example.com/v1
    timeoutMs: 30000
    headers:
      X-Client: openapi-dynamic-mcp
    retry429:
      maxRetries: 2
      baseDelayMs: 250
      maxDelayMs: 5000
      jitterRatio: 0.2
      respectRetryAfter: true
    oauth2:
      tokenUrlOverride: https://auth.example.com/oauth/token
      scopes: [read:pets, write:pets]
      tokenEndpointAuthMethod: client_secret_basic
```

### Validation Rules

- `apis[].name` must be unique (case-insensitive after normalization).
- `apis[].specPath` must point to a readable local file.
- OpenAPI version must be `3.x`.
- Base URL resolution order: env -> config -> `openapi.servers[0].url`.

## Environment Variables

### Name Normalization

API and auth scheme names are normalized as:

- uppercase
- non-alphanumeric -> `_`
- repeated `_` collapsed
- leading/trailing `_` removed

Examples:

- `pet-api` -> `PET_API`
- `OAuth2` -> `OAUTH2`

### API-Level Variables

- `<API>_BASE_URL`
- `<API>_HEADERS` (JSON object string)

### API Key Variables

- `<API>_<SCHEME>_API_KEY`

### OAuth2 Client Credentials Variables

- `<API>_<SCHEME>_CLIENT_ID`
- `<API>_<SCHEME>_CLIENT_SECRET`
- `<API>_<SCHEME>_TOKEN_URL`
- `<API>_<SCHEME>_SCOPES` (space-delimited)
- `<API>_<SCHEME>_TOKEN_AUTH_METHOD` (`client_secret_basic` or `client_secret_post`)

### Precedence

- Base URL: env > config > OpenAPI servers.
- OAuth token URL: scheme env > config override > OpenAPI flow `tokenUrl`.
- OAuth scopes: scheme env > config scopes > OpenAPI flow scopes.
- Headers: config headers + env headers + tool-request headers (later wins), then auth is applied.

## MCP Tools

### `list_apis`

Input:

```json
{}
```

Output:

```json
{
  "apis": [
    {
      "name": "pet-api",
      "title": "Pet API",
      "version": "1.0.0",
      "baseUrl": "https://api.example.com/v1",
      "specPath": "/abs/path/pet-api.yaml",
      "authSchemes": ["ApiKeyAuth", "OAuthCC"]
    }
  ]
}
```

### `list_api_endpoints`

Input fields:

- required: `apiName`
- optional: `method`, `tag`, `pathContains`, `search`, `limit`, `cursor`

### `get_api_endpoint`

Input fields: `apiName`, `endpointId`

Returns endpoint metadata including parameters, request body content types, responses, and security requirements.

### `get_api_schema`

Input fields: `apiName`, optional `pointer` (JSON Pointer)

### `make_endpoint_request`

Input fields:

- `apiName`
- `endpointId`
- `pathParams`
- `query`
- `headers`
- `cookies`
- `body`
- `contentType`
- `accept`
- `timeoutMs`
- `retry429` object
  - `maxRetries`
  - `baseDelayMs`
  - `maxDelayMs`
  - `jitterRatio` (0..1)
  - `respectRetryAfter`

Output includes:

- `request` metadata with redacted sensitive headers
- `response` status, headers, and body
- `timingMs`
- `authUsed`

## Development

```bash
npm test
npm run build
```

## Notes

- v1 supports local OpenAPI files only.
- 429 retries are supported and disabled by default (`maxRetries: 0`).
- JSON responses are parsed first; non-JSON is returned as text or base64 binary.
