import { OpenApiMcpError } from '../errors.js';

interface PropertySegment {
  type: 'property';
  key: string;
}

interface IndexSegment {
  type: 'index';
  index: number;
}

interface WildcardSegment {
  type: 'wildcard';
}

type Segment = PropertySegment | IndexSegment | WildcardSegment;

export function applyJsonPathFields<T>(value: T, selectors?: string[]): T {
  if (!selectors || selectors.length === 0) {
    return value;
  }

  let merged: unknown;
  for (const selector of selectors) {
    const segments = parseJsonPath(selector);
    const projected = projectValue(value, segments);
    if (projected !== undefined) {
      merged = mergeProjectedValues(merged, projected);
    }
  }

  return (merged === undefined ? {} : merged) as T;
}

export function parseJsonPath(path: string): Segment[] {
  if (!path.startsWith('$')) {
    throw new OpenApiMcpError(
      'REQUEST_ERROR',
      `Invalid JSONPath '${path}': must start with '$'`,
    );
  }

  const segments: Segment[] = [];
  let index = 1;
  while (index < path.length) {
    const char = path[index];
    if (char === '.') {
      const next = path[index + 1];
      if (!next) {
        throw invalidJsonPath(path, 'unexpected end after dot');
      }
      if (next === '.') {
        throw invalidJsonPath(path, 'recursive descent is not supported');
      }
      if (next === '*') {
        segments.push({ type: 'wildcard' });
        index += 2;
        continue;
      }
      const match = path.slice(index + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) {
        throw invalidJsonPath(path, 'invalid member selector');
      }
      segments.push({ type: 'property', key: match[0] });
      index += 1 + match[0].length;
      continue;
    }

    if (char === '[') {
      const closing = findBracketClose(path, index);
      const inner = path.slice(index + 1, closing);
      if (!inner) {
        throw invalidJsonPath(path, 'empty bracket selector');
      }
      if (inner === '*') {
        segments.push({ type: 'wildcard' });
        index = closing + 1;
        continue;
      }
      if (
        inner.includes('?') ||
        inner.includes(':') ||
        inner.includes(',') ||
        inner.includes('(')
      ) {
        throw invalidJsonPath(
          path,
          'filters, slices, and unions are not supported',
        );
      }
      if (/^\d+$/.test(inner)) {
        segments.push({ type: 'index', index: Number.parseInt(inner, 10) });
        index = closing + 1;
        continue;
      }
      const quote = inner[0];
      if (
        (quote === '"' || quote === "'") &&
        inner[inner.length - 1] === quote
      ) {
        segments.push({
          type: 'property',
          key: decodeQuotedMember(inner.slice(1, -1), quote),
        });
        index = closing + 1;
        continue;
      }
      throw invalidJsonPath(path, 'invalid bracket selector');
    }

    throw invalidJsonPath(path, `unexpected character '${char}'`);
  }

  return segments;
}

function projectValue(value: unknown, segments: Segment[]): unknown {
  if (segments.length === 0) {
    return value;
  }

  const [segment, ...rest] = segments;

  if (segment.type === 'property') {
    if (!isPlainObject(value) || !(segment.key in value)) {
      return undefined;
    }
    const child = projectValue(value[segment.key], rest);
    if (child === undefined) {
      return undefined;
    }
    return { [segment.key]: child };
  }

  if (segment.type === 'index') {
    if (
      !Array.isArray(value) ||
      segment.index < 0 ||
      segment.index >= value.length
    ) {
      return undefined;
    }
    const child = projectValue(value[segment.index], rest);
    if (child === undefined) {
      return undefined;
    }
    const out = new Array(value.length);
    out[segment.index] = child;
    return out;
  }

  if (Array.isArray(value)) {
    const out = new Array(value.length);
    let found = false;
    for (let i = 0; i < value.length; i += 1) {
      const child = projectValue(value[i], rest);
      if (child !== undefined) {
        out[i] = child;
        found = true;
      }
    }
    return found ? out : undefined;
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    let found = false;
    for (const [key, childValue] of Object.entries(value)) {
      const child = projectValue(childValue, rest);
      if (child !== undefined) {
        out[key] = child;
        found = true;
      }
    }
    return found ? out : undefined;
  }

  return undefined;
}

function mergeProjectedValues(base: unknown, addition: unknown): unknown {
  if (base === undefined) {
    return addition;
  }
  if (addition === undefined) {
    return base;
  }

  if (Array.isArray(base) && Array.isArray(addition)) {
    const out = new Array(Math.max(base.length, addition.length));
    for (let i = 0; i < out.length; i += 1) {
      if (base[i] !== undefined || addition[i] !== undefined) {
        out[i] = mergeProjectedValues(base[i], addition[i]);
      }
    }
    return out;
  }

  if (isPlainObject(base) && isPlainObject(addition)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(addition)) {
      out[key] = mergeProjectedValues(out[key], value);
    }
    return out;
  }

  return addition;
}

function decodeQuotedMember(value: string, quote: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== '\\') {
      out += char;
      continue;
    }

    const next = value[i + 1];
    if (next === undefined) {
      throw invalidJsonPath(
        `$[${quote}${value}${quote}]`,
        'unterminated escape sequence',
      );
    }
    i += 1;
    switch (next) {
      case '\\':
      case '"':
      case "'":
      case '/':
        out += next;
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'u': {
        const hex = value.slice(i + 1, i + 5);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
          throw invalidJsonPath(
            `$[${quote}${value}${quote}]`,
            'invalid unicode escape',
          );
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        throw invalidJsonPath(
          `$[${quote}${value}${quote}]`,
          `unsupported escape '\\${next}'`,
        );
    }
  }
  return out;
}

function findBracketClose(path: string, start: number): number {
  let quote: string | undefined;
  for (let index = start + 1; index < path.length; index += 1) {
    const char = path[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ']') {
      return index;
    }
  }
  throw invalidJsonPath(path, 'missing closing bracket');
}

function invalidJsonPath(path: string, message: string): OpenApiMcpError {
  return new OpenApiMcpError(
    'REQUEST_ERROR',
    `Invalid JSONPath '${path}': ${message}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
