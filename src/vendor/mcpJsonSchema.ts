import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sdkPackageJson =
  require.resolve('@modelcontextprotocol/sdk/package.json');
const compatPath = path.join(
  path.resolve(path.dirname(sdkPackageJson), '..', '..'),
  'dist/cjs/server/zod-json-schema-compat.js',
);

const compat = require(compatPath) as {
  toJsonSchemaCompat: (
    schema: unknown,
    opts?: unknown,
  ) => Record<string, unknown>;
};

export const { toJsonSchemaCompat } = compat;
