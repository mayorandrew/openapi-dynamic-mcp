<div align="center">
  <h1>openapi-dynamic-mcp</h1>

  <p>
    <strong>Connect AI clients to OpenAPI APIs quickly, with one MCP server, direct CLI access, and built-in auth support.</strong>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/openapi-dynamic-mcp"><img src="https://img.shields.io/npm/v/openapi-dynamic-mcp?color=blue&style=flat-square" alt="NPM Version" /></a>
    <a href="https://github.com/mayorandrew/openapi-dynamic-mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/openapi-dynamic-mcp?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/node/v/openapi-dynamic-mcp?style=flat-square" alt="Node.js Version" />
  </p>
</div>

## Table of Contents

- [Overview](#overview)
- [Highlights](#highlights)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Client Setup](#client-setup)
- [CLI](#cli)
- [Authentication](#authentication)
- [Environment Variables](#environment-variables)
- [Working with Responses](#working-with-responses)
- [Files and Binary Data](#files-and-binary-data)
- [MCP Tools](#mcp-tools)
- [Development](#development)
- [License](#license)

## Overview

`openapi-dynamic-mcp` lets MCP clients and shell users work with OpenAPI APIs without writing custom glue code for each service. Point it at one or more OpenAPI specs, then list APIs, inspect endpoints, authenticate, and make requests through a consistent interface.

It is designed for common user workflows:

- Connect multiple APIs through one MCP server
- Use local specs or hosted `specUrl` definitions
- Work with OpenAPI `3.0`, `3.1`, and Swagger `2.0`
- Handle API key, bearer, basic, and OAuth2 auth
- Reuse stored tokens across sessions
- Filter large responses down to the fields you need
- Preview requests safely before sending them

## Highlights

- **Get from spec to usable tools fast**: start from a YAML config and immediately browse endpoints or call them from MCP or the CLI.
- **Authenticate the way your API expects**: supports API keys, bearer/basic auth, and OAuth2 client credentials, password, device code, and auth code with PKCE.
- **Avoid repeated sign-in work**: store tokens once and reuse them later.
- **Handle interactive OAuth cleanly**: device-code and browser-based auth return instructions an agent can present to the user.
- **Keep responses focused**: project large outputs with JSONPath selectors.
- **Inspect before you send**: use dry runs to preview request shape without network I/O.
- **Upload files when needed**: supports multipart form uploads and raw binary bodies.
- **Stay resilient against rate limits**: configurable retries for `429 Too Many Requests`.

## Requirements

- Node.js `20+`

## Quick Start

Run the MCP server directly:

```bash
npx -y openapi-dynamic-mcp@latest --config ./config.yaml
```

Minimal config:

```yaml
version: 1
apis:
  - name: pet-api
    specPath: ./pet-api.yaml
```

You can also point at a remote spec:

```yaml
version: 1
apis:
  - name: pet-api
    specUrl: https://api.example.com/openapi.json
```

## Configuration

Add each API you want to use under `apis`. Each entry can point to a local spec file or a remote spec URL.

```yaml
version: 1

apis:
  - name: pet-api
    specPath: ./pet-api.yaml
    # specUrl: https://api.example.com/openapi.yaml
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
    oauth2Schemes:
      OAuthCC:
        tokenUrl: https://auth.example.com/oauth2/token
        scopes: [read:pets, write:pets]
        tokenEndpointAuthMethod: client_secret_basic
      UserAuth:
        authMethod: device_code
        deviceAuthorizationEndpoint: https://auth.example.com/oauth/device
        pkce: true
```

Common options:

- `name`: the API name shown in MCP and CLI commands
- `specPath` or `specUrl`: where to load the OpenAPI spec from
- `baseUrl`: override the server URL from the spec
- `headers`: headers to send on every request
- `timeoutMs`: default request timeout
- `retry429`: retry behavior for rate-limited APIs
- `oauth2Schemes`: per-scheme OAuth settings when the spec defines OAuth security

### Per-Scheme OAuth2 Configuration

Use `oauth2Schemes` when an API defines one or more OAuth2 security schemes and you want to set token URLs, scopes, or interactive auth preferences for a specific scheme.

The scheme name must match the name in the OpenAPI spec. Common options are:

- `tokenUrl`
- `scopes`
- `tokenEndpointAuthMethod`
- `authMethod`
- `deviceAuthorizationEndpoint`
- `pkce`

If you only need credentials, environment variables are often enough. Use `oauth2Schemes` when you want reusable config checked into the project.

## Client Setup

### Claude Desktop / Claude Code

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
      ]
    }
  }
}
```

## CLI

Server mode is available as either the root command or the explicit `serve` subcommand:

```bash
openapi-dynamic-mcp --config ./config.yaml
openapi-dynamic-mcp serve --config ./config.yaml
```

Use the CLI when you want the same API access outside your MCP client, for scripting, debugging, or auth setup.

### Tool Commands

Every MCP tool is also available as a CLI subcommand that accepts one JSON object and emits JSON output:

```bash
openapi-dynamic-mcp list_apis --config ./config.yaml --input '{}'
openapi-dynamic-mcp list_api_endpoints --config ./config.yaml --input '{"apiName":"pet-api"}'
openapi-dynamic-mcp get_api_endpoint --config ./config.yaml --input '{"apiName":"pet-api","endpointId":"listPets"}'
openapi-dynamic-mcp get_api_schema --config ./config.yaml --input '{"apiName":"pet-api","pointer":"/info"}'
openapi-dynamic-mcp make_endpoint_request --config ./config.yaml --input '{"apiName":"pet-api","endpointId":"listPets","dryRun":true}'
```

Shared flags:

- `--input <json>`: JSON object with command arguments
- `--fields <jsonpath>`: repeatable selector for filtering successful output
- `--describe`: print the command schema and help metadata
- `--auth-file <path>`: override the auth-store path

### Auth Command

Use `auth` to pre-authenticate one configured security scheme and persist its token for later MCP or CLI calls:

```bash
openapi-dynamic-mcp auth --config ./config.yaml --api pet-api --scheme OAuthCC
openapi-dynamic-mcp auth --config ./config.yaml --api pet-api --scheme ApiKeyAuth --token secret
```

For API key and bearer auth, `--token` provides the secret directly. For OAuth2, the command uses your configured credentials, completes the flow, and stores the result for later use.

## Authentication

Supported authentication types:

- API key
- HTTP bearer
- HTTP basic
- OAuth2 client credentials
- OAuth2 password grant (ROPC)
- OAuth2 device code
- OAuth2 authorization code with PKCE

Typical auth flow:

1. Provide credentials through environment variables or config
2. Run `auth` once if the scheme needs a stored token
3. Reuse that token from MCP or the CLI until it expires or changes

### Auth Store

By default, tokens are stored beside your config file in:

```text
.openapi-dynamic-mcp-auth.json
```

You can override that path with either:

- `--auth-file`
- `OPENAPI_DYNAMIC_MCP_AUTH_FILE`

This makes repeated API use much smoother, especially for MCP clients that need to reconnect often.

### Interactive OAuth2 Flows

When a request needs user interaction, the tool returns structured guidance that an MCP agent can relay to the user. Typical device-code output looks like:

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

This is especially useful for MCP agents because the auth step becomes a normal part of the user workflow instead of a dead-end error.

## Environment Variables

Environment variables are useful for secrets, base URL overrides, and CI setups.

Names are derived from normalized API and scheme names:

- Uppercase
- Non-alphanumeric characters become `_`
- Repeated `_` are collapsed
- Leading and trailing `_` are removed

Examples:

- `pet-api` -> `PET_API`
- `OAuth2` -> `OAUTH2`

### API-Level Variables

- `<API>_BASE_URL`
- `<API>_HEADERS` as a JSON object string
- `OPENAPI_DYNAMIC_MCP_AUTH_FILE`

### API Key

- `<API>_<SCHEME>_API_KEY`

### HTTP Auth

- `<API>_<SCHEME>_TOKEN`
- `<API>_<SCHEME>_USERNAME`
- `<API>_<SCHEME>_PASSWORD`

### OAuth2

- `<API>_<SCHEME>_ACCESS_TOKEN`
- `<API>_<SCHEME>_CLIENT_ID`
- `<API>_<SCHEME>_CLIENT_SECRET`
- `<API>_<SCHEME>_TOKEN_URL`
- `<API>_<SCHEME>_SCOPES` as a space-delimited list
- `<API>_<SCHEME>_TOKEN_AUTH_METHOD` as `client_secret_basic` or `client_secret_post`
- `<API>_<SCHEME>_USERNAME`
- `<API>_<SCHEME>_PASSWORD`
- `<API>_<SCHEME>_AUTH_METHOD` as `device_code` or `authorization_code`
- `<API>_<SCHEME>_DEVICE_AUTHORIZATION_ENDPOINT`
- `<API>_<SCHEME>_REDIRECT_PORT`
- `<API>_<SCHEME>_PKCE` as `true` or `false`

Useful behaviors:

- `_ACCESS_TOKEN` bypasses OAuth grant flows entirely.
- `_AUTH_METHOD` forces `device_code` or `authorization_code` when both are possible.
- `_USERNAME` and `_PASSWORD` are used for both HTTP basic auth and OAuth password grant, depending on the security scheme.

## Working with Responses

### JSONPath Filtering

CLI `--fields` and MCP `fields: string[]` let you keep only the parts of a successful response you care about. This is helpful when specs or payloads are too large to inspect comfortably.

Examples:

```bash
openapi-dynamic-mcp list_apis --config ./config.yaml --fields '$.apis[*].name'
openapi-dynamic-mcp get_api_endpoint --config ./config.yaml --input '{"apiName":"pet-api","endpointId":"listPets"}' --fields '$.responses'
```

Selectors support quoted member escaping, array indexes, and wildcards.

### Large Schema Warnings

`get_api_schema` adds a `_sizeWarning` advisory field when the response is very large, prompting you to narrow the JSON Pointer.

### Dry Runs

`make_endpoint_request` supports `dryRun: true` so you can confirm the URL, headers, auth, and serialized body before sending a real request.

## Files and Binary Data

`make_endpoint_request` supports both `multipart/form-data` and raw binary uploads.

Each file entry must provide exactly one content source: `base64`, `text`, or `filePath`.

```json
{
  "name": "avatar.png",
  "contentType": "image/png",
  "filePath": "/absolute/path/to/avatar.png"
}
```

Multipart example:

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

Raw binary example:

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

These five tools cover the main user workflows:

| Tool                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `list_apis`             | List configured APIs                                           |
| `list_api_endpoints`    | Search or paginate endpoints in one API                        |
| `get_api_endpoint`      | Inspect endpoint metadata, parameters, responses, and security |
| `get_api_schema`        | Return a schema object or JSON Pointer target from the spec    |
| `make_endpoint_request` | Preview or execute an endpoint request                         |

## Development

```bash
npm install
npm run build
npm test
```

Useful commands:

```bash
npm run lint
npm run format
npm run test:watch
```

## License

MIT
