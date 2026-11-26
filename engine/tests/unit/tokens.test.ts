import { describe, expect, it } from 'vitest';
import { type Diagnostic, DiagnosticError } from '../../src/diagnostic';
import { Lexer } from '../../src/lexer';
import { Preprocessor } from '../../src/preprocessor';
import { SourceFile } from '../../src/source';
import { Steps } from '../../src/steps';
import { type Token, TokenStream } from '../../src/tokens';

function stream(text: string, budget = 1000): { tokens: TokenStream; steps: Steps } {
  const steps = new Steps(budget);
  const lexer = new Lexer(new SourceFile('main.c', text), steps);
  return { tokens: new TokenStream(lexer, steps), steps };
}

/** Every token, without its range. */
function convert(text: string): Omit<Token, 'range'>[] {
  const { tokens } = stream(text);
  const all: Omit<Token, 'range'>[] = [];
  for (let token = tokens.next(); token.kind !== 'eof'; token = tokens.next()) {
    const { range: _range, ...rest } = token;
    all.push(rest);
  }
  return all;
}

function convertError(text: string): Diagnostic | undefined {
  try {
    convert(text);
  } catch (error) {
    if (error instanceof DiagnosticError) return error.diagnostic;
    throw error;
  }
  return undefined;
}

const value = (text: string): number | undefined => {
  const token = stream(text).tokens.next();
  return token.kind === 'integer' || token.kind === 'character' ? token.value : undefined;
};

const code = (text: string): string | undefined => convertError(text)?.code;

describe('TokenStream', () => {
  it('tells keywords from identifiers', () => {
    expect(convert('int x _Bool while1')).toEqual([
      { kind: 'keyword', keyword: 'int' },
      { kind: 'identifier', name: 'x' },
      { kind: 'keyword', keyword: '_Bool' },
      { kind: 'identifier', name: 'while1' },
    ]);
  });

  it('names an identifier by its characters, however they are written', () => {
    expect(convert('caf\\u00e9 café \\U0001F600')).toEqual([
      { kind: 'identifier', name: 'café' },
      { kind: 'identifier', name: 'café' },
      { kind: 'identifier', name: '😀' },
    ]);
  });

  it('checks the characters of identifiers', () => {
    expect(convertError('a\\u0024')).toMatchObject({
      code: 'syntax.invalid_identifier_character',
      args: { character: '\\u0024' },
      range: { start: { line: 1, column: 2 }, end: { line: 1, column: 8 } },
    });
    expect(code('\\u0301x')).toBe('syntax.invalid_identifier_character');
    expect(code('́x')).toBe('syntax.invalid_identifier_character');
    expect(convert('x́')).toEqual([{ kind: 'identifier', name: 'x́' }]);
    expect(convertError('a\\u0041')).toMatchObject({
      code: 'syntax.invalid_ucn',
      args: { ucn: '\\u0041' },
    });
    expect(code('\\ud800')).toBe('syntax.invalid_ucn');
    expect(code('\\U00110000')).toBe('syntax.invalid_ucn');
  });

  it('turns an included header into an include token', () => {
    const steps = new Steps(100);
    const lexer = new Lexer(new SourceFile('main.c', '#include <stdio.h>'), steps);
    const tokens = new TokenStream(new Preprocessor(lexer, steps), steps);
    expect(tokens.next()).toMatchObject({ kind: 'include', header: 'stdio.h' });
  });

  it('spells punctuators without digraphs', () => {
    expect(convert('<: :> <% %> %: %:%: ->')).toEqual(
      ['[', ']', '{', '}', '#', '##', '->'].map((punctuator) => ({
        kind: 'punctuator',
        punctuator,
      })),
    );
  });

  it('reads integer constants of type int', () => {
    expect(value('0')).toBe(0);
    expect(value('42')).toBe(42);
    expect(value('017')).toBe(15);
    expect(value('0x7fffffff')).toBe(2147483647);
    expect(value('0X1F')).toBe(31);
    expect(value('2147483647')).toBe(2147483647);
    expect(value('000000000000000000000000000001')).toBe(1);
  });

  it('answers other integer constants as a construct of 0.2', () => {
    for (const text of ['2147483648', '0x80000000', '1u', '1L', '1ll', '1Ul', '1LLU']) {
      expect(convertError(text)).toMatchObject({
        code: 'unsupported.construct',
        args: { construct: 'non_int_constant' },
      });
    }
  });

  it('reports integer constants no type holds', () => {
    expect(convertError('18446744073709551616')).toMatchObject({
      code: 'syntax.constant_too_large',
      args: { number: '18446744073709551616' },
    });
    // Unsuffixed decimal constants take only signed types.
    expect(code('9223372036854775808')).toBe('syntax.constant_too_large');
    expect(code('9'.repeat(1000))).toBe('syntax.constant_too_large');
    expect(code('9223372036854775808u')).toBe('unsupported.construct');
    expect(code('0xffffffffffffffff')).toBe('unsupported.construct');
  });

  it('reports malformed numbers', () => {
    for (const text of ['08', '1x', '0x', '1uu', '1lL', '1lul', '0b1', '1e', '0x1.0', '1.0q']) {
      expect(convertError(text)).toMatchObject({
        code: 'syntax.invalid_number',
        args: { number: text },
      });
    }
  });

  it('answers floating constants as a construct of 0.2', () => {
    for (const text of ['1.0', '.5', '1.', '1e5', '1E-5f', '0x1p3', '0x.8P-1L', '1.f']) {
      expect(convertError(text)).toMatchObject({
        code: 'unsupported.construct',
        args: { construct: 'float_constant' },
      });
    }
  });

  it('gives character constants the value GCC gives them', () => {
    expect(value("'a'")).toBe(97);
    expect(value("'\\n'")).toBe(10);
    expect(value("'\\0'")).toBe(0);
    expect(value("'\\''")).toBe(39);
    expect(value("'\\377'")).toBe(-1);
    expect(value("'\\xff'")).toBe(-1);
    expect(value("'\\x0041'")).toBe(65);
    expect(value("'ab'")).toBe(0x6162);
    expect(value("'abcde'")).toBe(0x62636465);
    expect(value("'\\xff\\xff\\xff\\xff'")).toBe(-1);
    expect(value("'é'")).toBe(0xc3a9);
    expect(value("'\\u00e9'")).toBe(0xc3a9);
  });

  it('checks escapes and character constants', () => {
    expect(convertError("x = '\\q';")).toEqual({
      code: 'syntax.invalid_escape',
      args: { escape: '\\q' },
      range: { file: 'main.c', start: { line: 1, column: 6 }, end: { line: 1, column: 8 } },
    });
    expect(code("'\\x'")).toBe('syntax.invalid_escape');
    expect(convertError("'\\400'")).toMatchObject({
      code: 'syntax.escape_out_of_range',
      args: { escape: '\\400' },
    });
    expect(convertError('"\\x100"')).toMatchObject({
      code: 'syntax.escape_out_of_range',
      args: { escape: '\\x100' },
    });
    expect(code(`"\\x${'0'.repeat(100)}1"`)).toBeUndefined();
    expect(convertError("'\\u12'")).toMatchObject({
      code: 'syntax.invalid_ucn',
      args: { ucn: '\\u12' },
    });
    expect(code("'\\u0041'")).toBe('syntax.invalid_ucn');
    expect(code("''")).toBe('syntax.empty_char_constant');
  });

  it('answers wide and Unicode literals as not supported', () => {
    for (const text of ["L'a'", "u'a'", "U'a'", 'L"a"', 'u8"a"', '"a" u"b"']) {
      expect(convertError(text)).toMatchObject({
        code: 'unsupported.construct',
        args: { construct: 'wide_char' },
      });
    }
    expect(convertError('"a" U"b"')?.range?.start.column).toBe(5);
  });

  it('decodes string literals into UTF-8 bytes', () => {
    expect(convert('"hi\\n" "é\\u00e9\\x1\\101"')).toEqual([
      {
        kind: 'string',
        bytes: Uint8Array.from([0x68, 0x69, 0x0a, 0xc3, 0xa9, 0xc3, 0xa9, 0x01, 0x41]),
      },
    ]);
  });

  it('concatenates adjacent string literals after decoding their escapes', () => {
    const { tokens, steps } = stream('"\\x1" "2"\n"" x');
    const joined = tokens.next();
    expect(joined).toMatchObject({ kind: 'string', bytes: Uint8Array.from([0x01, 0x32]) });
    expect(joined.range).toEqual({
      file: 'main.c',
      start: { line: 1, column: 1 },
      end: { line: 2, column: 3 },
    });
    // Three literal tokens, then the two bytes the concatenation built.
    expect(steps.used).toBe(3 + 2 + 1);
    expect(tokens.next()).toMatchObject({ kind: 'identifier', name: 'x' });
    expect(tokens.next()).toMatchObject({ kind: 'eof' });
  });

  it('charges nothing more for a literal on its own', () => {
    const { tokens, steps } = stream('"hello" ;');
    tokens.next();
    expect(steps.used).toBe(2);
  });

  it('reports characters no token can start with', () => {
    expect(convertError('int $x;')).toEqual({
      code: 'syntax.stray_character',
      args: { character: '$' },
      range: { file: 'main.c', start: { line: 1, column: 5 }, end: { line: 1, column: 6 } },
    });
    expect(convertError('a \\ b')).toMatchObject({ args: { character: '\\' } });
    expect(convertError('©')).toMatchObject({ args: { character: '©' } });
  });

  it('reports unterminated literals over the rest of their line', () => {
    expect(convertError('x = "abc;\ny')).toEqual({
      code: 'syntax.unterminated_string',
      args: {},
      range: { file: 'main.c', start: { line: 1, column: 5 }, end: { line: 1, column: 10 } },
    });
    expect(code("'a")).toBe('syntax.unterminated_char');
    expect(code('L"a')).toBe('syntax.unterminated_string');
  });
});
