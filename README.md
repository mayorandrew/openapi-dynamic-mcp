# openapi-dynamic-mcp

TypeScript MCP stdio server that loads one or more OpenAPI 3.x specs from YAML config and exposes generic tools for API discovery and request execution.

## What It Does

- Runs as a single MCP stdio server for multiple APIs.
- Supports OpenAPI `3.x` and Swagger `2.0` specifications.
- Supports local spec files via `specPath` or remote URL specs via `specUrl`.
- Exposes generic MCP tools:
  - `list_apis`
  - `list_api_endpoints`
  - `get_api_endpoint`
  - `get_api_schema`
  - `make_endpoint_request`
- Supports auth:
  - `apiKey`
  - HTTP `bearer` and `basic` (`http`)
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

## Client Configuration

### Claude Code

```json
{
  "mcpServers": {
    "openapi": {
      "command": "npx",
      "args": [
        "-y",
        "openapi-dynamic-mcp@latest",
        "--config",
        "/absolute/path/to/config.yaml"
      ],
      "env": {
        "PET_API_BASE_URL": "http://localhost:3000",
        "PET_API_APIKEY_API_KEY": "secret",
        "PET_API_OAUTH2_CLIENT_ID": "client_id",
        "PET_API_OAUTH2_CLIENT_SECRET": "client_secret"
      }
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "openapi": {
      "command": "npx",
      "args": [
        "-y",
        "openapi-dynamic-mcp@latest",
        "--config",
        "/absolute/path/to/config.yaml"
      ],
      "env": {
        "PET_API_BASE_URL": "http://localhost:3000",
        "PET_API_APIKEY_API_KEY": "secret",
        "PET_API_OAUTH2_CLIENT_ID": "client_id",
        "PET_API_OAUTH2_CLIENT_SECRET": "client_secret"
      }
    }
  }
}
```

## Configuration

```yaml
# Config file version
version: 1
apis:
  # Unique ID for this API
  - name: pet-api
    # Path to local OpenAPI spec (use specUrl for remote definitions)
    specPath: ./pet-api.yaml
    # Alternative: remote OpenAPI spec URL
    # specUrl: https://api.example.com/openapi.yaml
    # Base URL override
    baseUrl: https://api.example.com/v1
    # Request timeout in milliseconds
    timeoutMs: 30000
    headers:
      # Custom headers for all requests
      X-Client: openapi-dynamic-mcp
    # Configuration for exponential retries on 429 Too Many Requests responses
    retry429:
      # Maximum number of retries
      maxRetries: 2
      # Initial retry delay in milliseconds
      baseDelayMs: 250
      # Maximum retry delay in milliseconds
      maxDelayMs: 5000
      # Jitter factor (0-1)
      jitterRatio: 0.2
      # Respect Retry-After header
      respectRetryAfter: true
    # OAuth2 client credentials configuration
    oauth2:
      # Optional token URL override
      tokenUrlOverride: https://auth.example.com/oauth2/token
      # Scopes to request
      scopes: [read:pets, write:pets]
      # How to pass Client Credentials to the token endpoint:
      # Via HTTP Basic Authorization header: "client_secret_basic"
      # Via POST body: "client_secret_post"
      tokenEndpointAuthMethod: client_secret_basic
```

### Validation Rules

- `apis[].name` must be unique (case-insensitive after normalization).
- Exactly one of `apis[].specPath` (local file) or `apis[].specUrl` (remote URL) must be provided.
- Supported specifications: OpenAPI `3.x` and Swagger `2.0`.
- Base URL resolution order: env -> config -> `openapi.servers[0].url`.

## Environment Variables

Environment variables allow specifying sensitive or environment-specific configuration for APIs. Variables are defined for each API separately.

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

- `<API>_BASE_URL` - Overrides the API's base URL.
- `<API>_HEADERS` (JSON object string) - Adds custom headers to all requests.

### API Key Variables

For each API key security scheme defined in the OpenAPI spec, the following environment variables can be set:

- `<API>_<SCHEME>_API_KEY` - The API key value for the specified security scheme.

### HTTP Authentication Variables

For each HTTP Bearer or Basic security scheme defined in the OpenAPI spec:

- `<API>_<SCHEME>_TOKEN` - The Bearer token value.
- `<API>_<SCHEME>_USERNAME` - The Basic auth username.
- `<API>_<SCHEME>_PASSWORD` - The Basic auth password.

### OAuth2 Client Credentials Variables

For each OAuth2 client credentials security scheme defined in the OpenAPI spec, the following environment variables can be set:

- `<API>_<SCHEME>_CLIENT_ID` - The client ID for OAuth2.
- `<API>_<SCHEME>_CLIENT_SECRET` - The client secret for OAuth2.
- `<API>_<SCHEME>_TOKEN_URL` - The token endpoint URL for OAuth2.
- `<API>_<SCHEME>_SCOPES` (space-delimited) - The scopes required for the OAuth2 token.
- `<API>_<SCHEME>_TOKEN_AUTH_METHOD` (`client_secret_basic` or `client_secret_post`) - The authentication method for the token endpoint.

### Precedence

- Base URL: env > config > OpenAPI servers.
- OAuth token URL: scheme env > config override > OpenAPI flow `tokenUrl`.
- OAuth scopes: scheme env > config scopes > OpenAPI flow scopes.
- Headers: config headers + env headers + tool-request headers (later wins), then auth is applied.

## Handling Binary Data and File Uploads

When your LLM needs to send a file to an endpoint (either raw `application/octet-stream`, or inside a `multipart/form-data` payload), MCP passes messages as JSON. To do this, the LLM should format the corresponding file using the **files** parameter mapping.

The `make_endpoint_request` tool intercepts the `files` argument dict and processes each entry natively (e.g., converting to Blobs and FormData for accurate multipart boundary generation).

### MCP File Descriptor format

Each key in the `files` object maps to a form field name, and the value must follow this format:

```json
{
  "name": "avatar.png", // (Optional) Explicit file name
  "contentType": "image/png", // (Optional) Explicit mime type

  // You must provide EXACTLY ONE of the following content fields:
  "base64": "iVBORw0KGgo...", // Base64 encoded bytes
  "text": "File contents", // Raw text content
  "filePath": "/path/to/img" // Local absolute file path to read
}
```

### Example: Multipart Form-Data

If an endpoint expects a `profileImage` file and a `description` string via `multipart/form-data`:

```json
{
  "apiName": "pet-api",
  "endpointId": "uploadProfile",
  "contentType": "multipart/form-data",
  "body": {
    "description": "A photo of Fido"
  },
  "files": {
    "profileImage": {
      "name": "fido.jpg",
      "contentType": "image/jpeg",
      "filePath": "/Users/local/images/fido.jpg"
    }
  }
}
```

### Example: Raw octet stream

If an endpoint expects a raw binary PUT upload lacking form fields:

```json
{
  "apiName": "pet-api",
  "endpointId": "uploadRaw",
  "contentType": "application/octet-stream",
  "files": {
    "body": {
      "filePath": "/Users/local/data.bin"
    }
  }
}
```

## MCP Tools

### `list_apis`

Returns all available APIs.

Input: Nothing

### `list_api_endpoints`

Paginate or search through endpoints in a given APIs.

Input fields:

- required: `apiName`
- optional: `method`, `tag`, `pathContains`, `search`, `limit`, `cursor`

### `get_api_endpoint`

Returns endpoint metadata including parameters, request body content types, responses, and security requirements.

Input fields: `apiName`, `endpointId`

### `get_api_schema`

Returns the detailed specification of a given schema object.

Input fields: `apiName`, optional `pointer` (JSON Pointer)

### `make_endpoint_request`

Executes an API endpoint request.

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
- `maxRetries429`

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

- Supports both local files and remote URLs, including automatic conversion of Swagger 2.0 specs to OpenAPI 3.0.x in-memory.
- 429 retries are supported and disabled by default (`maxRetries: 0`).
- JSON responses are parsed first; non-JSON is returned as text or base64 binary.
