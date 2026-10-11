import { LOCALES } from '@status-page/shared';
import { describe, expect, it } from 'vitest';
import { messages } from './index.js';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('mensagens', () => {
  const reference = flattenKeys(messages['pt-BR']).sort();

  it.each(LOCALES)('%s tem as mesmas chaves do pt-BR', (locale) => {
    expect(flattenKeys(messages[locale]).sort()).toEqual(reference);
  });

  it.each(LOCALES)('%s não tem textos vazios', (locale) => {
    const empty = flattenKeys(messages[locale]).filter((key) => {
      const text = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages[locale]);
      return typeof text !== 'string' || text.trim() === '';
    });
    expect(empty).toEqual([]);
  });
});
