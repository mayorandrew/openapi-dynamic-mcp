# openapi-dynamic-mcp

## Purpose

- This repository builds a Node.js 20+ TypeScript package that exposes OpenAPI-backed APIs through both an MCP stdio server and a matching CLI.
- Most changes should preserve parity between the MCP tools and the CLI commands.

## Project Shape

- `src/cli.ts`: CLI entrypoint and command wiring.
- `src/mcp/`: MCP server setup and tool registration.
- `src/mcp/tools/`: primary user-facing operations such as listing APIs, inspecting endpoints, and making requests.
- `src/openapi/`: spec loading, Swagger 2 to OpenAPI 3 conversion, and endpoint indexing.
- `src/http/`: request preparation and execution.
- `src/auth/`: auth resolution, OAuth flows, environment variable handling, and token storage.
- `src/config/`: YAML config loading and validation.
- `src/output/`: response shaping such as JSONPath field filtering.
- `test/`: Vitest coverage for config, auth, OpenAPI loading, tools, and request execution. Follow the more specific `AGENTS.md` files inside `test/` when working there.

## Working Guidelines

- Prefer changing `src/` and tests. Treat `dist/`, `coverage/`, and `node_modules/` as generated or external.
- Keep code aligned with the current stack: strict TypeScript, ESM modules, Node built-ins, and existing small-module organization.
- Match existing formatting and linting conventions: single quotes, trailing commas, and explicit types where they add clarity.
- If behavior changes in an MCP tool, check whether the corresponding CLI path or shared helper should change too.
- Favor deterministic tests with local fixtures and mocks over live network calls.

## Validation

- Use `npm run build` for TypeScript compilation.
- Use `npm run lint` for static checks.
- Use `npm test` for the full test suite, or run targeted Vitest files while iterating.
