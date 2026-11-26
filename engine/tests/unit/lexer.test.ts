import { describe, expect, it } from 'vitest';
import { type Diagnostic, DiagnosticError } from '../../src/diagnostic';
import { Lexer, type PPToken } from '../../src/lexer';
import { SourceFile } from '../../src/source';
import { Steps } from '../../src/steps';

function lexer(text: string, budget = 1000): { lexer: Lexer; steps: Steps } {
  const steps = new Steps(budget);
  return { lexer: new Lexer(new SourceFile('main.c', text), steps), steps };
}

function lexAll(text: string): PPToken[] {
  const { lexer: lex } = lexer(text);
  const tokens: PPToken[] = [];
  for (let token = lex.next(); token.kind !== 'eof'; token = lex.next()) tokens.push(token);
  return tokens;
}

/** Each token as `kind:text`. */
function spell(text: string): string[] {
  return lexAll(text).map((token) => `${token.kind}:${token.text}`);
}

function lexError(text: string): Diagnostic | undefined {
  try {
    lexAll(text);
  } catch (error) {
    if (error instanceof DiagnosticError) return error.diagnostic;
    throw error;
  }
  return undefined;
}

describe('Lexer', () => {
  it('splits a program into preprocessing tokens', () => {
    expect(spell('int main(void) { return 0; }')).toEqual([
      'identifier:int',
      'identifier:main',
      'punctuator:(',
      'identifier:void',
      'punctuator:)',
      'punctuator:{',
      'identifier:return',
      'number:0',
      'punctuator:;',
      'punctuator:}',
    ]);
  });

  it('takes the longest punctuator', () => {
    expect(spell('a+++++b x<<=y ... .. ->')).toEqual([
      'identifier:a',
      'punctuator:++',
      'punctuator:++',
      'punctuator:+',
      'identifier:b',
      'identifier:x',
      'punctuator:<<=',
      'identifier:y',
      'punctuator:...',
      'punctuator:.',
      'punctuator:.',
      'punctuator:->',
    ]);
  });

  it('reads digraphs as punctuators spelled as written', () => {
    expect(spell('<: :> <% %> %: %:%:')).toEqual([
      'punctuator:<:',
      'punctuator::>',
      'punctuator:<%',
      'punctuator:%>',
      'punctuator:%:',
      'punctuator:%:%:',
    ]);
  });

  it('replaces trigraphs before anything else', () => {
    expect(spell("??=define x ??( ??) ??< ??> ??! ??- ??' ???=")).toEqual([
      'punctuator:#',
      'identifier:define',
      'identifier:x',
      'punctuator:[',
      'punctuator:]',
      'punctuator:{',
      'punctuator:}',
      'punctuator:|',
      'punctuator:~',
      'punctuator:^',
      'punctuator:?',
      'punctuator:#',
    ]);
  });

  it('splices lines, a trigraph backslash included, keeping offsets as written', () => {
    const [token] = lexAll('  ma\\\nin');
    expect(token).toMatchObject({ kind: 'identifier', text: 'main', start: 2, end: 8 });
    expect(spell('a??/\nb')).toEqual(['identifier:ab']);
    expect(spell('// comment \\\n still comment\nx')).toEqual(['identifier:x']);
  });

  it('reads preprocessing numbers', () => {
    expect(spell('0x1e+1 1.2.3e+4 .5 1e 08 1p-2 1_a')).toEqual([
      'number:0x1e+1',
      'number:1.2.3e+4',
      'number:.5',
      'number:1e',
      'number:08',
      'number:1p-2',
      'number:1_a',
    ]);
    expect(spell('1+2')).toEqual(['number:1', 'punctuator:+', 'number:2']);
  });

  it('reads character constants and string literals, with prefixes', () => {
    expect(spell(`"a\\"b" '\\'' L"x" u8"x" u'x' U"x" u8'x'`)).toEqual([
      'string:"a\\"b"',
      "character:'\\''",
      'string:L"x"',
      'string:u8"x"',
      "character:u'x'",
      'string:U"x"',
      'identifier:u8',
      "character:'x'",
    ]);
  });

  it('runs an unterminated literal to the end of its line', () => {
    const tokens = lexAll('"abc\nx \'d');
    expect(tokens.map((token) => `${token.kind}:${token.text}`)).toEqual([
      'other:"abc',
      'identifier:x',
      "other:'d",
    ]);
    expect(tokens[1]?.lineStart).toBe(true);
  });

  it('reads identifiers with universal character names and UTF-8 characters', () => {
    expect(spell('caf\\u00e9 café \\U0001F600x 𝑥 \\u12 →')).toEqual([
      'identifier:caf\\u00e9',
      'identifier:café',
      'identifier:\\U0001F600x',
      'identifier:𝑥',
      'other:\\',
      'identifier:u12',
      'other:→',
    ]);
  });

  it('reads any other character as one token', () => {
    expect(spell('@ $ ` \\ © \u{F0000}')).toEqual([
      'other:@',
      'other:$',
      'other:`',
      'other:\\',
      'other:©',
      'other:\u{F0000}',
    ]);
  });

  it('marks the first token of a line and the tokens after a space', () => {
    const tokens = lexAll('a/**/b c\n#x /*\n*/ #');
    expect(tokens.map((token) => [token.text, token.lineStart, token.spaceBefore])).toEqual([
      ['a', true, false],
      ['b', false, true],
      ['c', false, true],
      ['#', true, true],
      ['x', false, false],
      ['#', false, true],
    ]);
  });

  it('reports an unterminated comment at its start', () => {
    expect(lexError('x\n  /* never closed')).toEqual({
      code: 'syntax.unterminated_comment',
      args: {},
      range: { file: 'main.c', start: { line: 2, column: 3 }, end: { line: 2, column: 5 } },
    });
  });

  it('reads header names only when asked, on the same line', () => {
    const { lexer: lex } = lexer('include <stdio.h> "a.h"\n<b.h>');
    lex.next();
    expect(lex.headerName()).toMatchObject({ kind: 'header', text: '<stdio.h>' });
    expect(lex.headerName()).toMatchObject({ kind: 'header', text: '"a.h"' });
    expect(lex.headerName()).toBeUndefined();
    expect(lex.next()).toMatchObject({ kind: 'punctuator', text: '<', lineStart: true });

    expect(lexer('<> ""').lexer.headerName()).toBeUndefined();

    const unclosed = lexer('<a.h\n>').lexer;
    expect(unclosed.headerName()).toBeUndefined();
    expect(unclosed.next()).toMatchObject({ kind: 'punctuator', text: '<' });
  });

  it('charges one step per token, none at the end of the file', () => {
    const { lexer: lex, steps } = lexer(' a /* c */ + 1 ');
    while (lex.next().kind !== 'eof');
    lex.next();
    expect(steps.used).toBe(3);
  });

  it('stops at the token past the budget, with its place', () => {
    const { lexer: lex } = lexer('a\n  b', 1);
    lex.next();
    let diagnostic: Diagnostic | undefined;
    try {
      lex.next();
    } catch (error) {
      if (error instanceof DiagnosticError) diagnostic = error.diagnostic;
    }
    expect(diagnostic).toEqual({
      code: 'limit.steps',
      args: { limit: 1 },
      range: { file: 'main.c', start: { line: 2, column: 3 }, end: { line: 2, column: 3 } },
    });
  });

  it('ends with an eof token at the end of the file, again and again', () => {
    const { lexer: lex } = lexer('x\n');
    lex.next();
    expect(lex.next()).toMatchObject({ kind: 'eof', start: 2, end: 2 });
    expect(lex.next()).toMatchObject({ kind: 'eof' });
    expect(spell('')).toEqual([]);
  });
});
