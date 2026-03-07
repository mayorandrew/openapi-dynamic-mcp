<div align="center">
  <h1>openapi-dynamic-mcp</h1>

  <p>
    <strong>A TypeScript MCP stdio server that seamlessly loads multiple OpenAPI 2.x, 3.0, and 3.1 specifications and exposes powerful, generic tools for AI agents.</strong>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/openapi-dynamic-mcp"><img src="https://img.shields.io/npm/v/openapi-dynamic-mcp?color=blue&style=flat-square" alt="NPM Version" /></a>
    <a href="https://github.com/mayorandrew/openapi-dynamic-mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/openapi-dynamic-mcp?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/node/v/openapi-dynamic-mcp?style=flat-square" alt="Node.js Version" />
  </p>
</div>

## Table of Contents

- [What It Does](#what-it-does)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Client Configuration](#client-configuration)
  - [Claude Desktop / Claude Code](#claude-desktop--claude-code)
  - [Cursor](#cursor)
- [Configuration](#configuration)
  - [Per-Scheme OAuth2 Configuration](#per-scheme-oauth2-configuration)
- [Environment Variables](#environment-variables)
  - [OAuth2 Flows](#oauth2-flows)
- [Advanced Features](#advanced-features)
  - [File Uploads and Binary Data](#file-uploads-and-binary-data)
- [Available MCP Tools](#available-mcp-tools)
- [Development](#development)
- [License](#license)

## What It Does

`openapi-dynamic-mcp` runs as a single Model Context Protocol (MCP) server over `stdio` for multiple APIs. It acts as a bridge between your LLMs and your API, taking care of parsing, request execution, authentication, and error handling.

- **Multi-API Support**: Run a single server for any number of APIs simultaneously.
- **Specification Compatibility**: Supports OpenAPI `3.0`, `3.1`, and Swagger `2.0` specifications.
- **Dynamic Resolution**: Supports local spec files via `specPath` or remote URL specs via `specUrl`.
- **Robust Authentication**: Handles API Keys, HTTP `bearer`/`basic`, and OAuth2 (client credentials, password, device code, authorization code with PKCE). Supports complex OpenAPI security requirements (AND/OR logic).
- **Environment Overrides**: Easily override base URLs, tokens, and extra headers per API.
- **Resilience**: Configurable exponential retries on `429 Too Many Requests` responses.
- **Tested**: Continuously tested against real-world APIs.

## Requirements

- Node.js `20+`

## Quick Start

Run the server directly using `npx`:

```bash
npx -y openapi-dynamic-mcp@latest --config ./config.yaml
```

## CLI Usage

```
openapi-dynamic-mcp --config <path>

Options:
  --config, -c    Path to YAML configuration file (required)
  --help, -h      Show help
  --version, -v   Show version number
```

## Client Configuration

To use this with your favorite MCP-compatible client, add it to their respective config files.

### Claude Desktop / Claude Code

Add the following to your `claude_desktop_config.json` or equivalent:

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

Add to your MCP servers in Cursor settings:

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
        "PET_API_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Configuration

Create a YAML configuration file to define your APIs.

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
    # Per-scheme OAuth2 configuration (see below)
    oauth2Schemes:
      MyOAuth:
        tokenUrl: https://auth.example.com/oauth2/token
        scopes: [read:pets, write:pets]
        tokenEndpointAuthMethod: client_secret_basic
```

### Validation Rules

- `apis[].name` must be unique (case-insensitive after normalization).
- Exactly one of `apis[].specPath` (local file) or `apis[].specUrl` (remote URL) must be provided.
- Supported specifications: OpenAPI `3.0`, `3.1`, and Swagger `2.0`.
- Base URL resolution order: env > config > `openapi.servers[0].url`.

### Per-Scheme OAuth2 Configuration

> **Breaking change in v1.0.0:** The `oauth2` config key has been replaced by `oauth2Schemes`, which is keyed by security scheme name instead of being a flat per-API object.

The `oauth2Schemes` config key allows fine-grained configuration per OAuth2 security scheme defined in your OpenAPI spec:

```yaml
oauth2Schemes:
  # Key must match the security scheme name in the OpenAPI spec
  MyOAuth:
    # Override the token endpoint URL
    tokenUrl: https://auth.example.com/oauth2/token
    # Scopes to request
    scopes: [read, write]
    # How to send client credentials: client_secret_basic (default) or client_secret_post
    tokenEndpointAuthMethod: client_secret_basic
    # For authorizationCode flows: device_code or authorization_code
    authMethod: device_code
    # Device authorization endpoint (required for device_code method)
    deviceAuthorizationEndpoint: https://auth.example.com/device
    # Enable/disable PKCE for authorization_code method (default: true)
    pkce: true
  AnotherOAuth:
    tokenUrl: https://other.example.com/token
    authMethod: authorization_code
```

All fields are optional. Values from env vars take precedence over config values, which take precedence over values from the OpenAPI spec.

## Environment Variables

Environment variables allow specifying sensitive or environment-specific configuration for APIs. Variables are defined for each API separately.

### Name Normalization

API and auth scheme names are normalized automatically:

- Uppercase
- Non-alphanumeric -> `_`
- Repeated `_` collapsed
- Leading/trailing `_` removed

_Examples:_

- `pet-api` -> `PET_API`
- `OAuth2` -> `OAUTH2`

### API-Level Variables

- `<API>_BASE_URL` - Overrides the API's base URL.
- `<API>_HEADERS` (JSON object string) - Adds custom headers to all requests.

### Authentication Variables

**API Key** (`<API>_<SCHEME>_API_KEY`)

- The API key value for the specified security scheme.

**HTTP Authentication**

- `<API>_<SCHEME>_TOKEN` - Bearer token value.
- `<API>_<SCHEME>_USERNAME` - Basic auth username.
- `<API>_<SCHEME>_PASSWORD` - Basic auth password.

**OAuth2 (all flows)**

- `<API>_<SCHEME>_ACCESS_TOKEN` - Pre-obtained access token. When set, skips all grant flows entirely. Works for any OAuth2 flow type.
- `<API>_<SCHEME>_CLIENT_ID` - Client ID.
- `<API>_<SCHEME>_CLIENT_SECRET` - Client secret.
- `<API>_<SCHEME>_TOKEN_URL` - Token endpoint URL override.
- `<API>_<SCHEME>_SCOPES` (space-delimited) - Scopes to request.
- `<API>_<SCHEME>_TOKEN_AUTH_METHOD` (`client_secret_basic` or `client_secret_post`) - Auth method for the token endpoint.

**OAuth2 Password (ROPC) flow** (additional)

- `<API>_<SCHEME>_USERNAME` - Resource owner username.
- `<API>_<SCHEME>_PASSWORD` - Resource owner password.

**OAuth2 Interactive flows** (additional)

- `<API>_<SCHEME>_AUTH_METHOD` (`device_code` or `authorization_code`) - Choose the interactive method. Auto-detected if not set.
- `<API>_<SCHEME>_DEVICE_AUTHORIZATION_ENDPOINT` - Device authorization endpoint URL (required for `device_code`).
- `<API>_<SCHEME>_REDIRECT_PORT` - Pin the local callback port for `authorization_code` flow.
- `<API>_<SCHEME>_PKCE` (`true` or `false`) - Enable/disable PKCE for `authorization_code` (default: `true`).

_Precedence Rules:_

- **Base URL:** env > config > OpenAPI servers.
- **OAuth token URL:** scheme env > config override > OpenAPI flow `tokenUrl`.
- **OAuth scopes:** scheme env > config scopes > OpenAPI flow scopes.
- **OAuth auth method:** env `_AUTH_METHOD` > config `authMethod` > auto-detect.
- **Headers:** config headers + env headers + tool-request headers (later wins), then auth is applied.

### OAuth2 Flows

| Flow               | Method               | How it works                                                                              | Required env vars                                                |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Client Credentials | Automatic            | Server-to-server token exchange                                                           | `_CLIENT_ID`, `_CLIENT_SECRET`                                   |
| Password (ROPC)    | Automatic            | Username/password grant                                                                   | `_CLIENT_ID`, `_CLIENT_SECRET`, `_USERNAME`, `_PASSWORD`         |
| Authorization Code | `device_code`        | Returns verification URL + user code for the agent to present to the user. Poll on retry. | `_CLIENT_ID`, `_CLIENT_SECRET`, `_DEVICE_AUTHORIZATION_ENDPOINT` |
| Authorization Code | `authorization_code` | Returns authorization URL. Starts local callback server. Poll on retry.                   | `_CLIENT_ID`, `_CLIENT_SECRET`                                   |
| Implicit           | N/A                  | Not supported server-side. Use `_ACCESS_TOKEN` bypass.                                    | `_ACCESS_TOKEN`                                                  |

**Interactive flow UX (device code and authorization code):**

When an endpoint requires an interactive OAuth2 flow, `make_endpoint_request` returns a structured response instead of an error:

```json
{
  "status": "authorization_required",
  "method": "device_code",
  "message": "User authorization required. Ask the user to visit the URL and enter the code.",
  "verificationUri": "https://auth.example.com/device",
  "userCode": "ABCD-1234",
  "instruction": "After the user confirms, call this endpoint again."
}
```

The same information is also printed to stderr for direct CLI users. Call the endpoint again after the user authorizes to complete the flow and get the API response.

**Tip:** Set `<API>_<SCHEME>_ACCESS_TOKEN` to skip all interactive flows. This is useful for CI/CD or when you already have a token from another source.

## Advanced Features

### File Uploads and Binary Data

When your AI needs to send a file to an endpoint (either raw `application/octet-stream`, or inside a `multipart/form-data` payload), MCP passes messages as JSON. The LLM formats the corresponding file using the `files` parameter mapping, and `make_endpoint_request` processes it natively (converting to Blobs and FormData).

#### MCP File Descriptor format

Each key in the `files` object maps to a form field name. You must provide exactly one of `base64`, `text`, or `filePath`:

```jsonc
{
  "name": "avatar.png", // (Optional) Explicit file name
  "contentType": "image/png", // (Optional) Explicit mime type

  // Choose EXACTLY ONE content source:
  "base64": "iVBORw0KGgo...", // Base64 encoded bytes
  "text": "File contents", // Raw text content
  "filePath": "/path/to/img", // Local absolute file path to read
}
```

#### Example: Multipart Form-Data

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

#### Example: Raw Octet Stream

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

## Available MCP Tools

These tools are exposed to your MCP client:

| Tool                    | Description                                                     | Inputs                                                                                                                              |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list_apis`             | Returns all available configured APIs                           | _None_                                                                                                                              |
| `list_api_endpoints`    | Paginate or search endpoints in an API                          | `apiName` (req), `method`, `tag`, `pathContains`, `search`, `limit`, `cursor`                                                       |
| `get_api_endpoint`      | Endpoint metadata (parameters, body types, responses, security) | `apiName`, `endpointId`                                                                                                             |
| `get_api_schema`        | Detailed API schema object specification                        | `apiName`, `pointer` (JSON Pointer, optional)                                                                                       |
| `make_endpoint_request` | Executes the actual API endpoint request                        | `apiName`, `endpointId`, `pathParams`, `query`, `headers`, `cookies`, `body`, `contentType`, `accept`, `timeoutMs`, `maxRetries429` |

`get_api_schema` includes a `_sizeWarning` advisory field when the response exceeds 200KB, suggesting a more specific JSON pointer.

## Development

Install dependencies and run tests:

```bash
npm install
npm test
npm run build
```

## License

This project is licensed under the MIT License.
