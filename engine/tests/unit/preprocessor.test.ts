import { describe, expect, it } from 'vitest';
import { type Diagnostic, DiagnosticError } from '../../src/diagnostic';
import { Lexer, type PPToken } from '../../src/lexer';
import { Preprocessor } from '../../src/preprocessor';
import { SourceFile } from '../../src/source';
import { Steps } from '../../src/steps';

function preprocessor(text: string, budget = 1000): { pp: Preprocessor; steps: Steps } {
  const steps = new Steps(budget);
  const lexer = new Lexer(new SourceFile('main.c', text), steps);
  return { pp: new Preprocessor(lexer, steps), steps };
}

function all(text: string): PPToken[] {
  const { pp } = preprocessor(text);
  const tokens: PPToken[] = [];
  for (let token = pp.next(); token.kind !== 'eof'; token = pp.next()) tokens.push(token);
  return tokens;
}

/** Each token as `kind:text`. */
function spell(text: string): string[] {
  return all(text).map((token) => `${token.kind}:${token.text}`);
}

function ppError(text: string): Diagnostic | undefined {
  try {
    all(text);
  } catch (error) {
    if (error instanceof DiagnosticError) return error.diagnostic;
    throw error;
  }
  return undefined;
}

const construct = (text: string): string | number | undefined => {
  const diagnostic = ppError(text);
  return diagnostic?.code === 'unsupported.construct' ? diagnostic.args.construct : undefined;
};

describe('Preprocessor', () => {
  it('passes the supported headers on as header tokens', () => {
    expect(spell('#include <stdio.h>\n  # include<stdlib.h>\nint x;')).toEqual([
      'header:<stdio.h>',
      'header:<stdlib.h>',
      'identifier:int',
      'identifier:x',
      'punctuator:;',
    ]);
    expect(spell('%:include <stdio.h>')).toEqual(['header:<stdio.h>']);
  });

  it("expands a header's macros only after its #include", () => {
    expect(spell('EOF\n#include <stdio.h>\nEOF EXIT_SUCCESS')).toEqual([
      'identifier:EOF',
      'header:<stdio.h>',
      'punctuator:(',
      'punctuator:-',
      'number:1',
      'punctuator:)',
      'identifier:EXIT_SUCCESS',
    ]);
    expect(spell('#include <stdlib.h>\nEXIT_SUCCESS EXIT_FAILURE')).toEqual([
      'header:<stdlib.h>',
      'number:0',
      'number:1',
    ]);
  });

  it('gives the tokens a macro produces its place, charging one step each', () => {
    const { pp, steps } = preprocessor('#include <stdio.h>\nreturn EOF;');
    pp.next();
    pp.next();
    const used = steps.used;
    const open = pp.next();
    expect(steps.used - used).toBe(1 + 4);
    expect(open).toMatchObject({ kind: 'punctuator', text: '(', start: 26, end: 29 });
  });

  it('reports a header outside the subset', () => {
    expect(ppError('#include <string.h>')).toEqual({
      code: 'unsupported.header',
      args: { header: '<string.h>' },
      range: { file: 'main.c', start: { line: 1, column: 10 }, end: { line: 1, column: 20 } },
    });
    expect(ppError('#include <unistd.h>')?.args).toEqual({ header: '<unistd.h>' });
    expect(ppError('#include <constructor>')?.code).toBe('unsupported.header');
  });

  it('answers a local #include as a construct of 0.9', () => {
    expect(ppError('#include "list.h"\n')).toEqual({
      code: 'unsupported.construct',
      args: { construct: 'local_include' },
      range: { file: 'main.c', start: { line: 1, column: 1 }, end: { line: 1, column: 18 } },
    });
  });

  it('reports an #include without a header name', () => {
    expect(ppError('#include stdio.h')).toMatchObject({
      code: 'syntax.invalid_include',
      range: { start: { line: 1, column: 10 }, end: { line: 1, column: 15 } },
    });
    expect(ppError('#include\nint x;')).toMatchObject({
      code: 'syntax.invalid_include',
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
    });
    expect(ppError('#include <>')?.code).toBe('syntax.invalid_include');
    expect(ppError('#include <stdio.h')?.code).toBe('syntax.invalid_include');
  });

  it('reports tokens after the header name', () => {
    expect(ppError('#include <stdio.h> x y\n')).toEqual({
      code: 'syntax.extra_tokens',
      args: { directive: 'include' },
      range: { file: 'main.c', start: { line: 1, column: 20 }, end: { line: 1, column: 23 } },
    });
    expect(spell('#include <stdio.h> // comment\n')).toEqual(['header:<stdio.h>']);
  });

  it('does nothing for the null directive', () => {
    expect(spell('#\n# /* c */\nint # x\n#')).toEqual([
      'identifier:int',
      'punctuator:#',
      'identifier:x',
    ]);
  });

  it('stops at #error with its tokens as the message', () => {
    expect(ppError('int x;\n#error  stop   "here" /* c */ now\nint y;')).toEqual({
      code: 'directive.error',
      args: { message: 'stop "here" now' },
      range: { file: 'main.c', start: { line: 2, column: 1 }, end: { line: 2, column: 34 } },
    });
    expect(ppError('#error')).toMatchObject({
      args: { message: '' },
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 7 } },
    });
    expect(ppError("#error don't")?.args).toEqual({ message: "don't" });
  });

  it('answers the other directives with their keys, over the whole directive', () => {
    expect(ppError('#define N 10\nint x;')).toEqual({
      code: 'unsupported.construct',
      args: { construct: 'define' },
      range: { file: 'main.c', start: { line: 1, column: 1 }, end: { line: 1, column: 13 } },
    });
    expect(construct('#define N (1)')).toBe('define');
    expect(construct('#define F(x) x')).toBe('function_macro');
    expect(construct('#define')).toBe('define');
    expect(construct('#undef N')).toBe('undef');
    for (const name of ['if 1', 'ifdef N', 'ifndef N', 'elif 1', 'else', 'endif']) {
      expect(construct(`#${name}`)).toBe('conditional_directive');
    }
    expect(construct('#line 10')).toBe('line_directive');
    expect(construct('#pragma once')).toBe('pragma');
  });

  it('answers _Pragma as a pragma, over the whole operator', () => {
    expect(ppError('_Pragma("once") int x;')).toMatchObject({
      args: { construct: 'pragma' },
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 16 } },
    });
    expect(ppError('_Pragma x')?.range?.end.column).toBe(8);
    // Only the tokens that match are read: the unterminated comment is never reached.
    expect(ppError('_Pragma x /*')?.code).toBe('unsupported.construct');
  });

  it('reports directives C17 does not have', () => {
    expect(ppError('#warning hi')).toEqual({
      code: 'syntax.invalid_directive',
      args: { directive: 'warning' },
      range: { file: 'main.c', start: { line: 1, column: 2 }, end: { line: 1, column: 9 } },
    });
    expect(ppError('# 12 "main.c"')?.args).toEqual({ directive: '12' });
    expect(ppError('#include_next <stdio.h>')?.code).toBe('syntax.invalid_directive');
  });

  it('allows only spaces and tabs inside a directive', () => {
    expect(ppError('#\finclude <stdio.h>')).toMatchObject({
      code: 'syntax.directive_whitespace',
      range: { start: { line: 1, column: 3 } },
    });
    expect(ppError('#include\v<stdio.h>')?.code).toBe('syntax.directive_whitespace');
    expect(ppError('#error a\fb')?.code).toBe('syntax.directive_whitespace');
    expect(spell('\f#include <stdio.h>\n\fx')).toEqual(['header:<stdio.h>', 'identifier:x']);
    expect(spell('#include <stdio.h>\f')).toEqual(['header:<stdio.h>']);
    expect(ppError('#warning a\fb')?.code).toBe('syntax.invalid_directive');
  });

  it('runs a directive only at the start of a line', () => {
    expect(spell('x #include <stdio.h>')).toEqual([
      'identifier:x',
      'punctuator:#',
      'identifier:include',
      'punctuator:<',
      'identifier:stdio',
      'punctuator:.',
      'identifier:h',
      'punctuator:>',
    ]);
  });
});
