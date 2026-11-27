// Every diagnostic code has its message in both catalogs, with the same placeholders
// (design/frontend.md#i18n).
import { describe, expect, it } from 'vitest';
import languageSpec from '../../design/language.md?raw';
import diagnosticSource from '../../engine/src/diagnostic.ts?raw';
import tokensSource from '../../engine/src/tokens.ts?raw';
import enSource from '../messages/en.json?raw';
import esSource from '../messages/es.json?raw';

const catalogs = { en: JSON.parse(enSource), es: JSON.parse(esSource) } as Record<
  string,
  Record<string, unknown>
>;

/** The codes of the engine's `DiagnosticCode` type. */
const codes = [...diagnosticSource.matchAll(/^\s*\| '([a-z]+\.[a-z_]+)'/gm)].map((m) => m[1]);

/** The `unsupported.construct` keys of the language spec's two tables. */
const constructKeys = (() => {
  const from = languageSpec.indexOf('### Before its phase');
  const to = languageSpec.indexOf('## Undefined behavior');
  const rows = languageSpec.slice(from, to).matchAll(/^\| ((?:`[^`]+`(?:, )?)+) \|/gm);
  return [...rows].flatMap((row) => [...(row[1] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]));
})();

const keywords = new Set(
  [
    ...(tokensSource.match(/KEYWORDS = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((m) => m[1]),
);

const placeholders = (message: unknown) =>
  [...JSON.stringify(message).matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe('message catalogs', () => {
  it('have the same keys and placeholders in every language', () => {
    expect(Object.keys(catalogs.es ?? {}).sort()).toEqual(Object.keys(catalogs.en ?? {}).sort());
    for (const [key, message] of Object.entries(catalogs.en ?? {})) {
      expect(placeholders(catalogs.es?.[key]), key).toEqual(placeholders(message));
    }
  });

  it('have a message for every diagnostic code', () => {
    expect(codes.length).toBeGreaterThan(60);
    for (const code of codes) {
      for (const [locale, catalog] of Object.entries(catalogs)) {
        expect(catalog[`diagnostic_${code?.replace('.', '_')}`], `${locale} ${code}`).toBeTypeOf(
          'string',
        );
      }
    }
  });

  it('name every construct key that is not a keyword', () => {
    expect(constructKeys.length).toBeGreaterThan(30);
    for (const key of constructKeys) {
      if (keywords.has(key ?? '')) continue;
      expect(catalogs.en?.[`construct_${key}`], key).toBeTypeOf('string');
    }
  });
});
