<div align="center">
  <h1>openapi-dynamic-mcp</h1>
  
  <p>
    <strong>A TypeScript MCP stdio server that seamlessly loads multiple OpenAPI 2.x and 3.x specifications and exposes powerful, generic tools for AI agents.</strong>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/openapi-dynamic-mcp"><img src="https://img.shields.io/npm/v/openapi-dynamic-mcp?color=blue&style=flat-square" alt="NPM Version" /></a>
    <a href="https://github.com/mayorandrew/openapi-dynamic-mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/openapi-dynamic-mcp?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/node/v/openapi-dynamic-mcp?style=flat-square" alt="Node.js Version" />
  </p>
</div>

## 📖 Table of Contents

- [What It Does](#-what-it-does)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Client Configuration](#-client-configuration)
  - [Claude Desktop / Claude Code](#claude-desktop--claude-code)
  - [Cursor](#cursor)
- [Configuration](#-configuration)
  - [Environment Variables](#-environment-variables)
- [Advanced Features](#-advanced-features)
  - [File Uploads and Binary Data](#file-uploads-and-binary-data)
- [Available MCP Tools](#-available-mcp-tools)
- [Development](#-development)
- [License](#-license)

## ✨ What It Does

`openapi-dynamic-mcp` runs as a single Model Context Protocol (MCP) server over `stdio` for multiple APIs. It acts as a bridge between your LLMs and your API, taking care of parsing, request execution, authentication, and error handling.

- 🔄 **Multi-API Support**: Run a single server for any number of APIs simultaneously.
- 📄 **Specification Compatibility**: Seamlessly supports both OpenAPI `3.x` and Swagger `2.0` specifications.
- 🔌 **Dynamic Resolution**: Supports local spec files via `specPath` or remote URL specs via `specUrl`.
- 🔐 **Robust Authentication**: Handles API Keys, HTTP `bearer`/`basic`, and OAuth2 client credentials out-of-the-box. Supports complex OpenAPI security requirements (AND/OR logic).
- 🌍 **Environment Overrides**: Easily override base URLs, tokens, and extra headers per API.
- 🔁 **Resilience**: Configurable exponential retries on `429 Too Many Requests` responses.
- ✅ **Tested**: Continuously tested against real-world APIs.

## 🚀 Requirements

- Node.js `20+`

## 🏃 Quick Start

Run the server directly using `npx`:

```bash
npx -y openapi-dynamic-mcp@latest --config ./config.yaml
```

## 🔌 Client Configuration

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

## ⚙️ Configuration

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

## 🔐 Environment Variables

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

**OAuth2 Client Credentials**

- `<API>_<SCHEME>_CLIENT_ID` - Client ID.
- `<API>_<SCHEME>_CLIENT_SECRET` - Client secret.
- `<API>_<SCHEME>_TOKEN_URL` - Token endpoint URL.
- `<API>_<SCHEME>_SCOPES` (space-delimited) - Scopes required for the OAuth2 token.
- `<API>_<SCHEME>_TOKEN_AUTH_METHOD` (`client_secret_basic` or `client_secret_post`) - Auth method for the token endpoint.

_Precedence Rules:_

- **Base URL:** env > config > OpenAPI servers.
- **OAuth token URL:** scheme env > config override > OpenAPI flow `tokenUrl`.
- **OAuth scopes:** scheme env > config scopes > OpenAPI flow scopes.
- **Headers:** config headers + env headers + tool-request headers (later wins), then auth is applied.

## 🛠️ Advanced Features

### File Uploads and Binary Data

When your AI needs to send a file to an endpoint (either raw `application/octet-stream`, or inside a `multipart/form-data` payload), MCP passes messages as JSON. The LLM formats the corresponding file using the `files` parameter mapping, and `make_endpoint_request` processes it natively (converting to Blobs and FormData).

#### MCP File Descriptor format

Each key in the `files` object maps to a form field name. You must provide exactly one of `base64`, `text`, or `filePath`:

```json
{
  "name": "avatar.png", // (Optional) Explicit file name
  "contentType": "image/png", // (Optional) Explicit mime type

  // Choose EXACTLY ONE content source:
  "base64": "iVBORw0KGgo...", // Base64 encoded bytes
  "text": "File contents", // Raw text content
  "filePath": "/path/to/img" // Local absolute file path to read
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

## 🧰 Available MCP Tools

These tools are exposed to your MCP client:

| Tool                    | Description                                                     | Inputs                                                                                                                              |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list_apis`             | Returns all available configured APIs                           | _None_                                                                                                                              |
| `list_api_endpoints`    | Paginate or search endpoints in an API                          | `apiName` (req), `method`, `tag`, `pathContains`, `search`, `limit`, `cursor`                                                       |
| `get_api_endpoint`      | Endpoint metadata (parameters, body types, responses, security) | `apiName`, `endpointId`                                                                                                             |
| `get_api_schema`        | Detailed API schema object specification                        | `apiName`, `pointer` (JSON Pointer, optional)                                                                                       |
| `make_endpoint_request` | Executes the actual API endpoint request                        | `apiName`, `endpointId`, `pathParams`, `query`, `headers`, `cookies`, `body`, `contentType`, `accept`, `timeoutMs`, `maxRetries429` |

## 💻 Development

Install dependencies and run tests:

```bash
npm install
npm test
npm run build
```

## 📄 License

This project is licensed under the MIT License.
