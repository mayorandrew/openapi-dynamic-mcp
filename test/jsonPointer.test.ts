import { describe, expect, it } from 'vitest';
import { getByJsonPointer } from '../src/openapi/jsonPointer.js';
import { OpenApiMcpError } from '../src/errors.js';

describe('getByJsonPointer', () => {
  it('returns root for empty pointer', () => {
    const obj = { a: 1 };
    expect(getByJsonPointer(obj)).toBe(obj);
    expect(getByJsonPointer(obj, '')).toBe(obj);
  });

  it('throws for invalid pointer', () => {
    expect(() => getByJsonPointer({}, 'a/b/c')).toThrowError(OpenApiMcpError);
  });

  it('navigates objects', () => {
    const obj = { a: { b: { c: 123 } } };
    expect(getByJsonPointer(obj, '/a/b/c')).toBe(123);
  });

  it('navigates arrays', () => {
    const arr = [1, { a: [2, 3] }];
    expect(getByJsonPointer(arr, '/1/a/0')).toBe(2);
  });

  it('throws on out-of-bounds array index', () => {
    expect(() => getByJsonPointer([1, 2], '/2')).toThrowError(OpenApiMcpError);
    expect(() => getByJsonPointer([1, 2], '/-1')).toThrowError(OpenApiMcpError);
    expect(() => getByJsonPointer([1, 2], '/invalid')).toThrowError(
      OpenApiMcpError,
    );
  });

  it('throws on missing object keys', () => {
    expect(() => getByJsonPointer({ a: 1 }, '/b')).toThrowError(
      OpenApiMcpError,
    );
  });

  it('throws if trying to navigate into scalar', () => {
    expect(() => getByJsonPointer({ a: 1 }, '/a/b')).toThrowError(
      OpenApiMcpError,
    );
  });

  it('handles escaped ~1 and ~0', () => {
    const obj = { 'a/b': { 'c~d': 123 } };
    expect(getByJsonPointer(obj, '/a~1b/c~0d')).toBe(123);
  });
});
