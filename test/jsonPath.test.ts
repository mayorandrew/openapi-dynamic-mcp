import { describe, expect, it } from 'vitest';
import { applyJsonPathFields, parseJsonPath } from '../src/output/jsonPath.js';

const payload = {
  apis: [
    { name: 'pet-api', meta: { 'x-name': 'pets' } },
    { name: 'user-api', meta: { 'x-name': 'users' } },
  ],
  info: { title: 'Demo' },
};

describe('applyJsonPathFields', () => {
  it('supports simple member selection', () => {
    expect(applyJsonPathFields(payload, ['$.info.title'])).toEqual({
      info: { title: 'Demo' },
    });
  });

  it('supports quoted escaped members and wildcards', () => {
    expect(applyJsonPathFields(payload, ["$.apis[*].meta['x-name']"])).toEqual({
      apis: [{ meta: { 'x-name': 'pets' } }, { meta: { 'x-name': 'users' } }],
    });
  });

  it('preserves array positions for explicit indexes', () => {
    expect(applyJsonPathFields(payload, ['$.apis[1].name'])).toEqual({
      apis: [undefined, { name: 'user-api' }],
    });
  });

  it('ignores unknown selectors and rejects invalid syntax', () => {
    expect(applyJsonPathFields(payload, ['$.missing'])).toEqual({});
    expect(() => applyJsonPathFields(payload, ['$..info'])).toThrow(
      /Invalid JSONPath/,
    );
  });

  it('supports unicode escapes in quoted members', () => {
    const complexPayload = {
      info: {
        'snowman\u2603': 'winter',
      },
    };

    expect(
      applyJsonPathFields(complexPayload, ["$.info['snowman\\u2603']"]),
    ).toEqual({
      info: {
        'snowman\u2603': 'winter',
      },
    });
  });

  it('merges multiple selectors into one projected object', () => {
    expect(
      applyJsonPathFields(payload, ['$.apis[0].name', '$.info.title']),
    ).toEqual({
      apis: [{ name: 'pet-api' }, undefined],
      info: { title: 'Demo' },
    });
  });

  it('rejects unsupported selectors and invalid unicode escapes', () => {
    expect(() => parseJsonPath('$.apis[0:2]')).toThrow(/not supported/);
    expect(() => parseJsonPath("$.info['bad\\u00ZZ']")).toThrow(
      /invalid unicode escape/,
    );
  });
});
