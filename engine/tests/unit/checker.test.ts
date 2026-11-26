import { describe, expect, it } from 'vitest';
import { Checker, type FunctionSymbol, type Program } from '../../src/checker';
import { type Diagnostic, DiagnosticError } from '../../src/diagnostic';
import { Lexer } from '../../src/lexer';
import { LIMITS, type Limits } from '../../src/limits';
import { Parser } from '../../src/parser';
import { Preprocessor } from '../../src/preprocessor';
import { SourceFile } from '../../src/source';
import { Steps } from '../../src/steps';
import { TokenStream } from '../../src/tokens';

/** Parses and checks to the end, pausing every `slice` steps. */
function check(
  text: string,
  limits: Partial<Limits> = {},
  slice = Number.POSITIVE_INFINITY,
): { program: Program; steps: Steps; pauses: number } {
  const steps = new Steps(1_000_000);
  const lexer = new Lexer(new SourceFile('main.c', text), steps);
  const parser = new Parser(new TokenStream(new Preprocessor(lexer, steps), steps), steps, 256);
  parser.pauseAt = Number.POSITIVE_INFINITY;
  const parse = parser.parse().next();
  if (!parse.done) throw new Error('the parser paused');
  const checker = new Checker(parse.value, steps, { ...LIMITS, ...limits });
  const run = checker.check();
  let pauses = 0;
  for (;;) {
    checker.pauseAt = steps.used + slice;
    const result = run.next();
    if (result.done) return { program: result.value, steps, pauses };
    pauses++;
  }
}

function checkError(text: string, limits: Partial<Limits> = {}): Diagnostic | undefined {
  try {
    check(text, limits);
  } catch (error) {
    if (error instanceof DiagnosticError) return error.diagnostic;
    throw error;
  }
  return undefined;
}

const main = (body: string) => `int main(void) { ${body} }`;
const code = (text: string) => checkError(text)?.code;
const inMain = (body: string) => code(main(body));
const construct = (text: string) => checkError(text)?.args.construct;

describe('Checker', () => {
  it('accepts a program of 0.1', () => {
    const text = `#include <stdio.h>
#include <stdlib.h>
int fib(int n);
int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
void report(int code) { if (code) exit(EXIT_FAILURE); return; }
int main() {
  int total = 0;
  for (int i = 0; i < 10; i++) {
    switch (i % 3) {
      case 0: total += fib(i); break;
      case 1 + 1: continue;
      default: { int total = 1; putchar('0' + total); }
    }
  }
  report(total < 0);
  printf("%d %s\\n", total, "done");
  puts("bye");
  return 0;
}`;
    const { program } = check(text);
    expect(program.main.name).toBe('main');
    // total, i, and the inner total: slots in declaration order.
    expect(program.main.locals.map((local) => [local.name, local.slot])).toEqual([
      ['total', 0],
      ['i', 1],
      ['total', 2],
    ]);
  });

  it('binds each name to its declaration, inner scopes first', () => {
    const { program } = check(main('int a = 1; { int a = 2; a = 3; } return a;'));
    const body = program.main.definition?.body.items ?? [];
    const outer = body[0];
    const block = body[1];
    const ret = body[2];
    if (outer?.kind !== 'declaration' || block?.kind !== 'block' || ret?.kind !== 'return') {
      throw new Error('unexpected tree');
    }
    const inner = block.items[0];
    const assign = block.items[1];
    if (inner?.kind !== 'declaration' || assign?.kind !== 'expression') throw new Error('tree');
    const target = assign.expression.kind === 'assign' ? assign.expression.target : undefined;
    expect(program.symbols.get(target as object)).toBe(
      program.symbols.get(inner.declarators[0] as object),
    );
    expect(program.symbols.get(ret.value as object)).toBe(
      program.symbols.get(outer.declarators[0] as object),
    );
  });

  it('gives library functions their header declarations and user functions their definitions', () => {
    const { program } = check(
      `#include <stdio.h>\nint twice(int x) { return 2 * x; }\n${main('return putchar(twice(1));')}`,
    );
    const symbols = [...program.symbols.values()].filter(
      (s) => s.kind === 'function',
    ) as FunctionSymbol[];
    expect(symbols.find((s) => s.name === 'putchar')?.library?.name).toBe('putchar');
    expect(symbols.find((s) => s.name === 'twice')?.definition).toBeDefined();
    // A subset function declared by the program, without its header, is the library's too.
    const declared = check(`int putchar(int c);\n${main('return putchar(65);')}`).program;
    const putchar = [...declared.symbols.values()].find(
      (s) => s.name === 'putchar',
    ) as FunctionSymbol;
    expect(putchar.library?.name).toBe('putchar');
    // A definition with a header function's name is the program's, before or after the header.
    for (const text of [
      `#include <stdio.h>\nint putchar(int c) { return c; }\n${main('return putchar(65);')}`,
      `int putchar(int c) { return c; }\n#include <stdio.h>\n${main('return putchar(65);')}`,
    ]) {
      const own = [...check(text).program.symbols.values()].find(
        (s) => s.name === 'putchar',
      ) as FunctionSymbol;
      expect(own.definition).toBeDefined();
      expect(own.library).toBeUndefined();
    }
    expect(
      construct(
        `int putchar(int c) { return c; }\n#include <stdio.h>\n${main('return putchar("a");')}`,
      ),
    ).toBe('array');
  });

  it('reports names', () => {
    expect(checkError(main('return x;'))).toEqual({
      code: 'name.undeclared',
      args: { name: 'x' },
      range: { file: 'main.c', start: { line: 1, column: 25 }, end: { line: 1, column: 26 } },
    });
    expect(inMain('{ int a; } return a;')).toBe('name.undeclared');
    expect(inMain('printf("x");')).toBe('name.undeclared');
    expect(inMain('int x = x + 1; return later();')).toBe('name.undeclared');
    expect(checkError(main('int a; int a;'))).toMatchObject({
      code: 'name.redefined',
      args: { name: 'a' },
    });
    expect(checkError('int f(int a, int a);\nint main(void) { return 0; }')).toMatchObject({
      code: 'name.redefined',
      args: { name: 'a' },
      range: { start: { line: 1, column: 14 }, end: { line: 1, column: 19 } },
    });
    expect(code('int f(int a, int a) { return a; }\nint main(void) { return 0; }')).toBe(
      'name.redefined',
    );
    expect(code('int f(int a) { int a; return 0; }\nint main(void) { return 0; }')).toBe(
      'name.redefined',
    );
    expect(
      code('int f(void) { return 1; }\nint f(void) { return 2; }\nint main(void) { return 0; }'),
    ).toBe('name.redefined');
    expect(inMain('int f; int f(void);')).toBe('name.redefined');
    expect(code('int f(int) { return 0; }\nint main(void) { return 0; }')).toBe(
      'name.unnamed_parameter',
    );
    expect(checkError(`int helper(void);\n${main('return helper();')}`)).toMatchObject({
      code: 'name.undefined_function',
      args: { name: 'helper' },
      range: { start: { line: 2, column: 25 } },
    });
    expect(code('int helper(void);\nint main(void) { return 0; }')).toBeUndefined();
    expect(checkError('int helper(void) { return 0; }')).toEqual({
      code: 'name.missing_main',
      args: {},
    });
    expect(code('int main(void);')).toBe('name.missing_main');
  });

  it('reports C17 library functions outside the subset, before undeclared names', () => {
    expect(checkError(main('return strlen("x");'))).toMatchObject({
      code: 'unsupported.function',
      args: { name: 'strlen' },
      range: { start: { column: 25 }, end: { column: 31 } },
    });
    expect(inMain('return abs(1);')).toBe('unsupported.function');
    expect(code(`int abs(int);\n${main('return abs(1);')}`)).toBe('unsupported.function');
    // A function the program defines is its own, whatever its name.
    expect(
      code(`int abs(int x) { return x < 0 ? -x : x; }\n${main('return abs(1);')}`),
    ).toBeUndefined();
    expect(code(`int putchar(int c) { return c; }\n${main('return putchar(1);')}`)).toBeUndefined();
    // Only a call: any other use of such a name is an undeclared name.
    expect(inMain('time = 1; return 0;')).toBe('name.undeclared');
    expect(inMain('return abs;')).toBe('name.undeclared');
  });

  it('reports values of the wrong type', () => {
    expect(checkError(main('void x;'))).toMatchObject({
      code: 'type.void_object',
      args: { name: 'x' },
    });
    const voidFn = 'void f(void) { }\n';
    expect(code(`${voidFn}${main('return f();')}`)).toBe('type.void_value');
    expect(code(`${voidFn}${main('int x = f() + 1;')}`)).toBe('type.void_value');
    expect(code(`${voidFn}${main('if (f()) ;')}`)).toBe('type.void_value');
    expect(code(`${voidFn}${main('return 1 ? f() : 2;')}`)).toBe('type.void_value');
    expect(code(`${voidFn}${main('1 ? f() : f(); f(), 1; return 0;')}`)).toBeUndefined();
    expect(inMain('1 = 2;')).toBe('type.not_assignable');
    expect(inMain('int a; a + 1 = 2;')).toBe('type.not_assignable');
    expect(inMain('5++;')).toBe('type.not_assignable');
    // The target is checked as an expression first.
    expect(construct(main('"a" = 1;'))).toBe('array');
    expect(inMain('strlen("a") = 1;')).toBe('unsupported.function');
    expect(code(`int g(void);\n${main('g = 1;')}`)).toBe('type.not_assignable');
    expect(inMain('int a; a();')).toBe('type.not_callable');
    expect(code(`int g(void);\n${main('return g()();')}`)).toBe('type.not_callable');
  });

  it('checks calls against their declarations', () => {
    const two = 'int add(int a, int b) { return a + b; }\n';
    expect(checkError(`${two}${main('return add(1);')}`)).toMatchObject({
      code: 'type.too_few_arguments',
      args: { function: 'add' },
    });
    expect(checkError(`${two}${main('return add(1, 2, 3);')}`)).toMatchObject({
      code: 'type.too_many_arguments',
      args: { function: 'add' },
      range: { start: { line: 2, column: 35 } },
    });
    // `()` means no parameters.
    expect(code(`int f() { return 0; }\n${main('return f(1);')}`)).toBe('type.too_many_arguments');
    expect(code(`#include <stdio.h>\n${main('printf();')}`)).toBe('type.too_few_arguments');
    expect(checkError(`#include <stdio.h>\n${main('puts(5);')}`)).toMatchObject({
      code: 'type.argument_type',
      args: { function: 'puts', position: 1 },
    });
    expect(code(`#include <stdio.h>\n${main('putchar("a");')}`)).toBe('type.argument_type');
    expect(code(`#include <stdlib.h>\n${main('exit("1");')}`)).toBe('type.argument_type');
    expect(construct(`#include <stdio.h>\n${main('puts(0);')}`)).toBe('pointer');
    expect(
      code(`#include <stdio.h>\n${main('printf("%d %s", 1, "x"); return 0;')}`),
    ).toBeUndefined();
  });

  it('accepts string literals only as arguments of library functions', () => {
    expect(checkError(main('int x = "a";'))).toMatchObject({
      code: 'unsupported.construct',
      args: { construct: 'array' },
      range: { start: { column: 26 }, end: { column: 29 } },
    });
    expect(construct(`int f(int x);\n${main('return f("a");')}`)).toBe('array');
    expect(construct(`#include <stdio.h>\n${main('puts(1 ? "a" : "b");')}`)).toBe('array');
    expect(construct(`int f(int, ...);\n${main('return f(1, "a");')}`)).toBe('array');
  });

  it('answers a function used as a value as a function pointer', () => {
    expect(construct(`int g(void);\n${main('int x = g;')}`)).toBe('function_pointer');
    expect(construct(`#include <stdio.h>\n${main('return printf == 0;')}`)).toBe(
      'function_pointer',
    );
  });

  it('checks returns', () => {
    expect(checkError('void f(void) { return 1; }\nint main(void) { return 0; }')).toMatchObject({
      code: 'type.return_value_in_void',
      args: { function: 'f' },
    });
    expect(
      code('void f(void) { }\nvoid g(void) { return f(); }\nint main(void) { return 0; }'),
    ).toBe('type.return_value_in_void');
    expect(checkError('int f(void) { return; }\nint main(void) { return 0; }')).toMatchObject({
      code: 'type.missing_return_value',
      args: { function: 'f' },
    });
  });

  it('checks declarations and declarators', () => {
    expect(checkError('int f(void);\nvoid f(void);\nint main(void) { return 0; }')).toMatchObject({
      code: 'type.conflicting_types',
      args: { name: 'f' },
      range: { start: { line: 2, column: 6 } },
    });
    expect(code('int f();\nint f(int a);\nint main(void) { return 0; }')).toBe(
      'type.conflicting_types',
    );
    expect(code('int puts(int c);\n#include <stdio.h>\nint main(void) { return 0; }')).toBe(
      'type.conflicting_types',
    );
    expect(
      code('int f(int a);\nint f(int b) { return b; }\nint main(void) { return 0; }'),
    ).toBeUndefined();
    expect(code('int f(void x);\nint main(void) { return 0; }')).toBe(
      'type.invalid_void_parameter',
    );
    expect(code('int f(int a, void);\nint main(void) { return 0; }')).toBe(
      'type.invalid_void_parameter',
    );
    expect(checkError('int f(void)(void);\nint main(void) { return 0; }')).toMatchObject({
      code: 'type.function_returning_function',
      args: { name: 'f' },
    });
    expect(inMain('int f(void) = 1;')).toBe('type.invalid_initializer');
    expect(inMain('int x = {1, 2};')).toBe('type.invalid_initializer');
    expect(inMain('int x = {{1}};')).toBe('type.invalid_initializer');
    expect(inMain('int x = {1}; return x;')).toBeUndefined();
    expect(inMain('for (int f(void);;) ;')).toBe('syntax.for_declaration');
  });

  it('accepts only the main forms of 0.1', () => {
    expect(code('int main() { return 0; }')).toBeUndefined();
    expect(checkError('void main(void) { }')).toMatchObject({
      code: 'type.invalid_main',
      range: { start: { column: 1 }, end: { column: 16 } },
    });
    expect(code('int main(int argc) { return argc; }')).toBe('type.invalid_main');
    expect(code('int main(int, ...);\nint main(void) { return 0; }')).toBe('type.invalid_main');
  });

  it('checks break, continue, case and default', () => {
    expect(inMain('break;')).toBe('syntax.break_outside_loop');
    expect(inMain('continue;')).toBe('syntax.continue_outside_loop');
    expect(inMain('switch (1) { continue; }')).toBe('syntax.continue_outside_loop');
    expect(inMain('while (1) { switch (1) { case 1: continue; } }')).toBeUndefined();
    expect(inMain('switch (1) { case 1: break; }')).toBeUndefined();
    expect(inMain('case 1: ;')).toBe('syntax.case_outside_switch');
    expect(inMain('default: ;')).toBe('syntax.case_outside_switch');
    // A case inside a loop inside a switch belongs to the switch.
    expect(inMain('switch (1) { while (0) { case 1: ; } }')).toBeUndefined();
    expect(inMain('switch (1) { default: ; default: ; }')).toBe('syntax.duplicate_default');
    expect(inMain('switch (1) { case 1: switch (2) { default: ; } default: ; }')).toBeUndefined();
  });

  it('evaluates case labels as integer constant expressions', () => {
    expect(checkError(main('switch (1) { case 1: case 2 - 1: ; }'))).toMatchObject({
      code: 'type.duplicate_case',
      args: { value: 1 },
    });
    expect(
      inMain("switch (1) { case 'a': case 97 + 1: case -1: case !0 + 5: case 1 ? 7 : 1 / 0: ; }"),
    ).toBeUndefined();
    expect(inMain('int x; switch (1) { case x: ; }')).toBe('type.not_constant');
    expect(inMain('switch (1) { case 1 / 0: ; }')).toBe('type.not_constant');
    expect(inMain('switch (1) { case (1, 2): ; }')).toBe('type.not_constant');
    expect(inMain('switch (1) { case 2147483647 + 1: ; }')).toBe('type.constant_overflow');
    expect(inMain('switch (1) { case -2147483647 - 1: ; }')).toBeUndefined();
    expect(inMain('switch (1) { case (-2147483647 - 1) / -1: ; }')).toBe('type.constant_overflow');
    expect(inMain('switch (1) { case 65536 * 65536: ; }')).toBe('type.constant_overflow');
    expect(inMain('switch (1) { case 0 && 1 / 0: ; }')).toBeUndefined();
    expect(inMain('int x; switch (1) { case 0 && x: case 1 || x: ; }')).toBeUndefined();
    expect(inMain('switch (1) { case (-2147483647 - 1) % -1: ; }')).toBe('type.constant_overflow');
    expect(inMain('switch (1) { case -(-2147483647 - 1): ; }')).toBe('type.constant_overflow');
    expect(inMain('switch (1) { case 1 % 0: ; }')).toBe('type.not_constant');
    expect(inMain('switch (1) { case 1 || 1 / 0: ; }')).toBeUndefined();
    // `0 / -1` is 0, not -0.
    expect(checkError(main('switch (0) { case 0: case 0 / -1: ; }'))?.args).toEqual({ value: 0 });
    // An operand, evaluated or not, is still checked as an expression.
    expect(inMain('switch (1) { case 0 && y: ; }')).toBe('name.undeclared');
    expect(inMain('switch (1) { case 1 || (1 = 2): ; }')).toBe('type.not_assignable');
    expect(construct(main('switch (1) { case 1 ? 2 : "a": ; }'))).toBe('array');
    expect(construct(main('switch (1) { case "a": ; }'))).toBe('array');
    expect(code(`void v(void) {}\n${main('switch (1) { case 0 ? v() : 3: ; }')}`)).toBe(
      'type.void_value',
    );
    expect(inMain('switch (1) { case strlen("a"): ; }')).toBe('unsupported.function');
  });

  it('adds up string literals as static data', () => {
    const text = `#include <stdio.h>\n${main('puts("abc"); puts("de"); return 0;')}`;
    // "abc" and "de" with their NULs: 7 bytes.
    expect(checkError(text, { staticData: 7 })).toBeUndefined();
    expect(checkError(text, { staticData: 6 })).toEqual({
      code: 'limit.static_data',
      args: { limit: 6 },
    });
  });

  it('charges one step per node and gives the same result in slices', () => {
    const text = `#include <stdio.h>\n${main('int a = 1; while (a < 5) a++; printf("%d", a); return 0;')}`;
    const whole = check(text);
    const sliced = check(text, {}, 2);
    expect(sliced.pauses).toBeGreaterThan(5);
    expect(sliced.steps.used).toBe(whole.steps.used);
    expect(sliced.program.main.locals).toEqual(whole.program.main.locals);
  });
});
