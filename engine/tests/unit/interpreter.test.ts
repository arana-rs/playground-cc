import { describe, expect, it } from 'vitest';
import { Checker } from '../../src/checker';
import { type Diagnostic, DiagnosticError } from '../../src/diagnostic';
import { Interpreter } from '../../src/interpreter';
import { Lexer } from '../../src/lexer';
import { LIMITS, type Limits } from '../../src/limits';
import { Parser } from '../../src/parser';
import { Preprocessor } from '../../src/preprocessor';
import { SourceFile } from '../../src/source';
import { Steps } from '../../src/steps';
import { TokenStream } from '../../src/tokens';

/** Runs a program to its end in slices of `slice` steps; `steps` counts the run's alone. */
function run(
  text: string,
  limits: Partial<Limits> = {},
  slice = 1000,
): { status?: number; diagnostic?: Diagnostic; steps: number } {
  const steps = new Steps(Number.MAX_SAFE_INTEGER);
  const lexer = new Lexer(new SourceFile('main.c', text), steps);
  const parser = new Parser(new TokenStream(new Preprocessor(lexer, steps), steps), steps, 256);
  parser.pauseAt = Number.POSITIVE_INFINITY;
  const unit = parser.parse().next();
  if (!unit.done) throw new Error('the parser paused');
  const checker = new Checker(unit.value, steps, LIMITS);
  checker.pauseAt = Number.POSITIVE_INFINITY;
  const program = checker.check().next();
  if (!program.done) throw new Error('the checker paused');
  const runSteps = new Steps(limits.steps ?? LIMITS.steps);
  const interpreter = new Interpreter(program.value, runSteps, { ...LIMITS, ...limits });
  try {
    for (;;) {
      const status = interpreter.advance(runSteps.used + slice);
      if (status !== undefined) return { status, steps: runSteps.used };
    }
  } catch (error) {
    if (!(error instanceof DiagnosticError)) throw error;
    return { diagnostic: error.diagnostic, steps: runSteps.used };
  }
}

const status = (text: string) => run(text).status;
const main = (body: string) => `int main(void) { ${body} }`;

describe('Interpreter', () => {
  it('computes int arithmetic as C does', () => {
    expect(status(main('return 7 / -2 == -3 && 7 % -2 == 1 && -7 % 2 == -1;'))).toBe(1);
    expect(status(main('return 2 + 3 * 4 - 10 / 3;'))).toBe(11);
    expect(status(main('return -(-5) + +2;'))).toBe(7);
    expect(status(main('return (1 < 2) + (2 <= 2) * 2 + (3 > 4) * 4 + (4 >= 4) * 8;'))).toBe(11);
    expect(status(main('return (1 == 1) + (1 != 1) * 2 + !5 * 4 + !0 * 8;'))).toBe(9);
    expect(status(main('return (0 || 7) + (3 && 9) * 2 + (0 && 1) * 4;'))).toBe(3);
    expect(status(main('return (1, 2, 3);'))).toBe(3);
    expect(status(main('return 0 ? 1 : 2 ? 3 : 4;'))).toBe(3);
    expect(status(main('return 65536 * 32767 / 65536;'))).toBe(32767 % 256);
    expect(status(main('return -2147483647 - 1 < 0;'))).toBe(1);
  });

  it('assigns, with compound assignment and increments', () => {
    expect(status(main('int a = 5; a += 3; a -= 1; a *= 4; a /= 3; a %= 5; return a;'))).toBe(4);
    expect(status(main('int a = 1, b; b = a++; return a * 10 + b;'))).toBe(21);
    expect(status(main('int a = 1, b; b = ++a; return a * 10 + b;'))).toBe(22);
    expect(status(main('int a = 1, b; b = a--; return a * 10 + b;'))).toBe(1);
    expect(status(main('int a, b; a = b = 4; return a + b;'))).toBe(8);
    // The value of `a = 3` is 3.
    expect(status(main('int a; return (a = 3) + 1;'))).toBe(4);
  });

  it('short-circuits && and || and evaluates one branch of ?:', () => {
    expect(status(main('int a = 0; 0 && a++; 1 || a++; 1 && a++; 0 || a++; return a;'))).toBe(2);
    expect(status(main('int a = 0, b = 0; 1 ? a++ : b++; 0 ? a++ : b++; return a * 10 + b;'))).toBe(
      11,
    );
  });

  it('runs if, while, do, for, break and continue', () => {
    expect(status(main('if (0) return 1; else if (1) return 2; return 3;'))).toBe(2);
    expect(status(main('int i = 0, s = 0; while (i < 5) s += i++; return s;'))).toBe(10);
    expect(status(main('int i = 10; do i++; while (0); return i;'))).toBe(11);
    expect(
      status(
        main(
          'int s = 0; for (int i = 0; i < 10; i++) { if (i == 5) continue; if (i == 8) break; s += i; } return s;',
        ),
      ),
    ).toBe(23);
    expect(status(main('int i = 0; for (;;) if (++i == 9) break; return i;'))).toBe(9);
    expect(
      status(main('int i = 0, n = 0; do { if (i++ % 2) continue; n++; } while (i < 6); return n;')),
    ).toBe(3);
    // `continue` in a `for` runs its third clause.
    expect(status(main('int n = 0; for (int i = 0; i < 4; i++, n++) continue; return n;'))).toBe(4);
  });

  it('runs switch with fallthrough, default anywhere and break', () => {
    const text = main(
      'int r = 0; for (int x = 0; x < 5; x++) switch (x) { case 0: r += 1; case 1: r += 10; break; default: r += 100; case 3: r += 1000; } return r % 256;',
    );
    // 11 + 10 + 1100 + 1000 + 1100 = 3221, modulo 256.
    expect(status(text)).toBe(149);
    expect(status(main('switch (5) { case 1: return 1; } return 2;'))).toBe(2);
    // `continue` inside a `switch` belongs to the loop around it.
    expect(
      status(
        main(
          'int n = 0; for (int i = 0; i < 3; i++) { switch (i) { case 1: continue; } n++; } return n;',
        ),
      ),
    ).toBe(2);
    // A `case` inside a loop inside the `switch`.
    expect(
      status(main('int n = 0; switch (2) { case 1: while (n < 5) { case 2: n += 2; } } return n;')),
    ).toBe(6);
  });

  it('calls functions, recursion included, with arguments left to right', () => {
    expect(
      status(
        `int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\n${main('return fib(20) % 256;')}`,
      ),
    ).toBe(6765 % 256);
    expect(status(`int sub(int a, int b) { return a - b; }\n${main('return sub(9, 4);')}`)).toBe(5);
    expect(
      status(`int twice(int x);\n${main('return twice(21);')}\nint twice(int x) { return 2 * x; }`),
    ).toBe(42);
    // Each call has its own locals.
    expect(
      status(`int f(int n) { int k = n; if (n) f(n - 1); return k; }\n${main('return f(5);')}`),
    ).toBe(5);
    expect(status(`void f(void) { return; }\n${main('f(); return 4;')}`)).toBe(4);
    // A function that ends without `return`, its value unused.
    expect(status(`int f(void) { }\n${main('f(); return 6;')}`)).toBe(6);
  });

  it('ends with the status main returns or exit gets, modulo 256', () => {
    expect(status(main('return 300;'))).toBe(44);
    expect(status(main('return -1;'))).toBe(255);
    expect(status(main(''))).toBe(0);
    expect(status(`#include <stdlib.h>\n${main('exit(3); return 1;')}`)).toBe(3);
    expect(
      status(
        `#include <stdlib.h>\nvoid f(int x) { if (x == 3) exit(-2); f(x + 1); }\n${main('f(0); return 1;')}`,
      ),
    ).toBe(254);
    // Declared without its header, `exit` is the library's.
    expect(status(`void exit(int);\n${main('exit(7);')}`)).toBe(7);
  });

  it('charges one step per operator, control transfer, call, return and local', () => {
    // The call of main, `+` and the return.
    expect(run(main('return 1 + 2;')).steps).toBe(3);
    // Plus the local `a` and its `=`.
    expect(run(main('int a; a = 2; return a;')).steps).toBe(4);
    // Each iteration: the test's `<` and its branch, the body's `++`.
    expect(run(main('int i = 0; while (i < 3) i++; return 0;')).steps).toBe(1 + 1 + 3 * 3 + 2 + 1);
    // `for (;;)` charges its jump back.
    expect(run(main('for (;;) {}'), { steps: 50 }).diagnostic).toMatchObject({
      code: 'limit.steps',
      args: { limit: 50 },
      range: { start: { line: 1, column: 18 }, end: { line: 1, column: 29 } },
    });
  });

  it('pauses between steps and ends the same whatever the slice size', () => {
    const text = `int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\n${main('int s = 0; for (int i = 0; i < 50; i++) s += fib(i % 12); return s % 256;')}`;
    const whole = run(text, {}, Number.POSITIVE_INFINITY);
    for (const slice of [1, 2, 7, 100]) expect(run(text, {}, slice)).toEqual(whole);
    const limited = run(text, { steps: 777 }, Number.POSITIVE_INFINITY);
    expect(limited.diagnostic?.code).toBe('limit.steps');
    for (const slice of [1, 3, 50]) expect(run(text, { steps: 777 }, slice)).toEqual(limited);
  });

  it('stops a call whose frame does not fit in the stack', () => {
    expect(run(`void f(void) { f(); }\n${main('f(); return 0;')}`).diagnostic).toEqual({
      code: 'limit.stack',
      args: { limit: LIMITS.stack },
      range: { file: 'main.c', start: { line: 1, column: 16 }, end: { line: 1, column: 19 } },
    });
    // Each frame is 16 bytes plus 4 per parameter and local: main's 16, then f's 24 each.
    const text = `int f(int n) { int k = n; return n ? f(n - 1) : k; }\n${main('return f(3);')}`;
    expect(run(text, { stack: 16 + 4 * 24 }).status).toBe(0);
    expect(run(text, { stack: 16 + 4 * 24 - 1 }).diagnostic?.code).toBe('limit.stack');
    // main's own frame is charged at its call.
    expect(run(main('int a = 1; return a;'), { stack: 19 }).diagnostic).toMatchObject({
      code: 'limit.stack',
      range: { start: { line: 1, column: 5 }, end: { line: 1, column: 9 } },
    });
  });

  it('ends the scope of a local when its block ends', () => {
    // On the second iteration `x` is a new block, never written.
    expect(() =>
      run(main('for (int i = 0; i < 2; i++) { int x; if (i) return x; x = 1; } return 0;')),
    ).toThrow('ub.uninitialized_read');
    expect(() =>
      run(
        main('int n = 0; while (n < 2) { int x; if (n++) return x; x = 1; continue; } return 0;'),
      ),
    ).toThrow('ub.uninitialized_read');
  });

  it('evaluates arguments left to right', () => {
    const text = `#include <stdlib.h>\nint stop(int n) { exit(n); return 0; }\nint sub(int a, int b) { return a - b; }\n${main('return sub(stop(1), stop(2));')}`;
    expect(status(text)).toBe(1);
  });

  it('takes a scalar initializer in braces', () => {
    expect(status(main('int a = { 5 }; return a;'))).toBe(5);
  });

  it('charges each iteration of an empty do loop', () => {
    expect(run(main('do ; while (1);'), { steps: 50 }).diagnostic?.code).toBe('limit.steps');
  });

  it('leaves the value of a function that ended without return to step 0.0.8', () => {
    expect(() => run(`int f(void) { }\n${main('return f();')}`)).toThrow('ub.missing_return');
  });
});
