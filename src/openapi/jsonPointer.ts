import { OpenApiMcpError } from "../errors.js";

export function getByJsonPointer(root: unknown, pointer?: string): unknown {
  if (!pointer || pointer === "") {
    return root;
  }

  if (!pointer.startsWith("/")) {
    throw new OpenApiMcpError("SCHEMA_ERROR", "JSON pointer must start with '/'", { pointer });
  }

  const tokens = pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let cursor: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(cursor)) {
      const idx = Number.parseInt(token, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        throw new OpenApiMcpError("SCHEMA_ERROR", "JSON pointer index out of bounds", { pointer, token });
      }
      cursor = cursor[idx];
      continue;
    }

    if (!cursor || typeof cursor !== "object") {
      throw new OpenApiMcpError("SCHEMA_ERROR", "JSON pointer target does not exist", {
        pointer,
        token
      });
    }

    const object = cursor as Record<string, unknown>;
    if (!(token in object)) {
      throw new OpenApiMcpError("SCHEMA_ERROR", "JSON pointer target does not exist", {
        pointer,
        token
      });
    }
    cursor = object[token];
  }

  return cursor;
}
