# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.3] - 2026-04-14

### Fixed

- Top-level `openapi-dynamic-mcp --help` now shows the root CLI command list with descriptions for `serve`, `auth`, and the tool subcommands instead of only the `serve` help output

## [0.3.1] - 2026-03-07

### Fixed

- Fixed `server.json` to match required schema

## [0.3.0] - 2026-03-07

### Added

- **CLI rewrite with cmd-ts**: `--help` / `-h`, `--version` / `-v`, and `-c` shorthand for `--config`
- **CLI tool parity for all MCP tools**: `list_apis`, `list_api_endpoints`, `get_api_endpoint`, `get_api_schema`, and `make_endpoint_request` are now available as direct CLI subcommands that accept a single JSON input object and emit JSON output
- **CLI `auth` command**: pre-authenticate one configured security scheme in CLI mode and persist OAuth2, API key, or bearer tokens for later MCP and CLI requests
- **Auth store dotfile support**: shared persisted token storage with `--auth-file` and `OPENAPI_DYNAMIC_MCP_AUTH_FILE` overrides
- **OAuth2 password (ROPC) flow**: support `grant_type=password` via `_USERNAME` and `_PASSWORD` env vars
- **OAuth2 device code flow (RFC 8628)**: interactive auth returning verification URL and user code for MCP agents
- **OAuth2 authorization code flow with PKCE**: interactive auth with local callback server for browser-based flows
- **Per-scheme OAuth2 configuration**: `oauth2Schemes` config key allows per-scheme `tokenUrl`, `scopes`, `tokenEndpointAuthMethod`, `authMethod`, `deviceAuthorizationEndpoint`, and `pkce`
- **`_ACCESS_TOKEN` env var**: universal OAuth2 bypass for any scheme — set a pre-obtained token to skip all grant flows
- **`_AUTH_METHOD` env var**: choose `device_code` or `authorization_code` per scheme (auto-detected otherwise)
- **`get_api_schema` size warnings**: advisory `_sizeWarning` field when response exceeds 200KB
- **JSONPath field filtering**: repeatable CLI `--fields` and MCP `fields: string[]` selectors for filtering successful tool output with quoted member escaping, array indexes, and wildcards
- **MCP output schema publication**: `tools/list` now advertises `outputSchema` for every tool alongside `inputSchema`
- **`make_endpoint_request.dryRun`**: validate auth, parameters, and request serialization and return a request preview without performing network I/O
- **Friendly specUrl error messages**: distinguishes "URL unreachable" from "not a valid OpenAPI spec" for remote specs
- **Auth error messages include env var names**: failed auth errors now list the specific env vars to set
- **OpenAPI 3.1 test coverage**: explicit validation of 3.1-specific features (type arrays, webhooks, info.summary)
- **JSONPath and auth-store test coverage**: dedicated tests for selector projection, auth-file precedence, expiry handling, dry-run, and CLI/MCP descriptor parity

### Changed

- Server version now read dynamically from package.json (was hardcoded `0.1.0`)
- MCP tool metadata, validation, and CLI execution now come from a single shared tool registry to eliminate schema drift between advertised and enforced contracts
- Auth resolution now checks persisted auth-store tokens after explicit environment variables and before OAuth grant flows
- Upgraded vitest to v4, @modelcontextprotocol/sdk, eslint, globals, lint-staged

### Fixed

- Server version mismatch: `Server` constructor version now matches package.json
- Authorization-code interactive auth now falls back cleanly when the local callback listener cannot bind in restricted environments

## [0.2.3] - 2025-05-28

### Changed

- Adjusted MCP registry metadata in server.json
- Scoped down GitHub workflow permissions

### Fixed

- Vulnerability fixes in dependencies

## [0.2.1] - 2025-05-27

### Fixed

- E2E test stability

### Added

- ESLint configuration
- Expanded test coverage

## [0.2.0] - 2025-05-26

### Added

- Swagger 2.0 support (automatic conversion to OpenAPI 3.0)
- Binary file upload support (multipart/form-data, application/octet-stream)
- HTTP Bearer and Basic authentication
- Prettier code formatting
- Husky and lint-staged pre-commit hooks
- Simplified 429 retry configuration
- Multiple search terms support for endpoint filtering
- Public API test suites (Authentiq.io, OneForge, OnePass, Ably)

## [0.1.0] - 2025-05-25

### Added

- Initial release
- Multi-API support via YAML configuration
- OpenAPI 3.x spec loading (local files and remote URLs)
- API Key authentication
- OAuth2 client credentials flow
- 5 MCP tools: `list_apis`, `list_api_endpoints`, `get_api_endpoint`, `get_api_schema`, `make_endpoint_request`
- Configurable 429 retry with exponential backoff
- Environment variable overrides for base URL, headers, and credentials
