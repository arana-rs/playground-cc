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
    const { diagnostic } = run(`void f(void) { f(); }\n${main('f(); return 0;')}`);
    const call = { file: 'main.c', start: { line: 1, column: 16 }, end: { line: 1, column: 19 } };
    expect(diagnostic).toMatchObject({
      code: 'limit.stack',
      args: { limit: LIMITS.stack },
      range: call,
    });
    // main's 16 bytes, then 16 for each call of f.
    expect(diagnostic?.stack?.total).toBe((LIMITS.stack - 16) / 16 + 1);
    expect(diagnostic?.stack?.frames).toHaveLength(LIMITS.frames);
    expect(diagnostic?.stack?.frames[0]).toEqual({ function: 'f', range: call });
    // Each frame is 16 bytes plus 4 per parameter and local: main's 16, then f's 24 each.
    const text = `int f(int n) { int k = n; return n ? f(n - 1) : k; }\n${main('return f(3);')}`;
    expect(run(text, { stack: 16 + 4 * 24 }).status).toBe(0);
    expect(run(text, { stack: 16 + 4 * 24 - 1 }).diagnostic?.code).toBe('limit.stack');
    // main's own frame is charged at its call, before main is on the stack.
    expect(run(main('int a = 1; return a;'), { stack: 19 }).diagnostic).toEqual({
      code: 'limit.stack',
      args: { limit: 19 },
      range: { file: 'main.c', start: { line: 1, column: 5 }, end: { line: 1, column: 9 } },
      stack: { frames: [], total: 0 },
    });
  });

  it('ends the scope of a local when its block ends', () => {
    // On the second iteration `x` is a new block, never written.
    expect(
      run(main('for (int i = 0; i < 2; i++) { int x; if (i) return x; x = 1; } return 0;'))
        .diagnostic?.code,
    ).toBe('ub.uninitialized_read');
    expect(
      run(main('int n = 0; while (n < 2) { int x; if (n++) return x; x = 1; continue; } return 0;'))
        .diagnostic?.code,
    ).toBe('ub.uninitialized_read');
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
});

/** The diagnostic a program ends with. */
const ub = (text: string, limits: Partial<Limits> = {}) => run(text, limits).diagnostic;
const at = (line: number, start: number, end: number) => ({
  file: 'main.c',
  start: { line, column: start },
  end: { line, column: end },
});

describe('Undefined behavior', () => {
  it('stops at a division or remainder by zero', () => {
    expect(ub(main('int z = 0; return 1 / z;'))).toEqual({
      code: 'ub.division_by_zero',
      args: {},
      range: at(1, 36, 41),
      stack: { frames: [{ function: 'main', range: at(1, 36, 41) }], total: 1 },
    });
    expect(ub(main('int z = 0; return 1 % z;'))?.code).toBe('ub.division_by_zero');
    expect(ub(main('int z = 0, a = 5; a /= z; return a;'))?.code).toBe('ub.division_by_zero');
  });

  it('stops at signed overflow, INT_MIN / -1 included', () => {
    const overflow = (body: string) => ub(main(body));
    expect(overflow('int a = 2147483647; return a + 1;')).toMatchObject({
      code: 'ub.signed_overflow',
      args: { type: 'int' },
      range: at(1, 45, 50),
    });
    expect(overflow('int a = -2147483647; return a - 2;')?.code).toBe('ub.signed_overflow');
    expect(overflow('int a = 65536; return a * a;')?.code).toBe('ub.signed_overflow');
    // The range of an operator covers its operands' parentheses.
    expect(overflow('int a = 65536; return a * (a);')?.range).toEqual(at(1, 40, 47));
    expect(overflow('int a = -2147483647 - 1; return -a;')?.code).toBe('ub.signed_overflow');
    expect(overflow('int a = -2147483647 - 1; return a / -1;')?.code).toBe('ub.signed_overflow');
    expect(overflow('int a = -2147483647 - 1; return a % -1;')?.code).toBe('ub.signed_overflow');
    expect(overflow('int a = 2147483647; a++; return 0;')?.code).toBe('ub.signed_overflow');
    expect(overflow('int a = -2147483647 - 1; --a; return 0;')?.code).toBe('ub.signed_overflow');
    expect(overflow('int a = 2147483647; a += 1; return 0;')?.code).toBe('ub.signed_overflow');
    // Up to the limits, no overflow.
    expect(run(main('int a = 2147483646; a++; return a - 2147483647;')).status).toBe(0);
    expect(run(main('int a = -2147483647 - 1; return a / 1 < 0;')).status).toBe(1);
  });

  it('stops at a read of a variable never written, with its name', () => {
    expect(ub(main('int x; return x;'))).toMatchObject({
      code: 'ub.uninitialized_read',
      args: { name: 'x' },
      range: at(1, 32, 33),
    });
    expect(ub(main('int x; x++; return 0;'))).toMatchObject({ args: { name: 'x' } });
    expect(ub(main('int x; x += 1; return 0;'))?.code).toBe('ub.uninitialized_read');
    // Its own initializer reads it before it is written.
    expect(ub(main('int x = x + 1; return x;'))).toMatchObject({
      code: 'ub.uninitialized_read',
      range: at(1, 26, 27),
    });
    // Writing it is not reading it.
    expect(run(main('int x; x = 3; return x;')).status).toBe(3);
    // A `switch` that jumps past a declaration leaves the variable unwritten.
    expect(ub(main('switch (1) { int y; case 1: return y; } return 0;'))?.code).toBe(
      'ub.uninitialized_read',
    );
  });

  it('stops at unsequenced accesses to one variable, with its name', () => {
    expect(ub(main('int i = 0; i = i++; return i;'))).toMatchObject({
      code: 'ub.unsequenced',
      args: { name: 'i' },
      range: at(1, 29, 36),
    });
    const unsequenced = (body: string) => ub(main(`int i = 1, j = 0; ${body} return 0;`))?.code;
    for (const body of [
      'j = i++ + i;',
      'j = i + i++;',
      'j = i++ * i++;',
      'i = ++i + 1;',
      'i += i++;',
      'i += (i++, 1);',
      'j = (i = 1) + i;',
      'j = (i = 1) + (i = 2);',
      'i = (i = 2);',
      'j = (i++, 0) + i;',
      'j = (1 ? i++ : 0) + i;',
      'j = -(i++) + i;',
    ]) {
      expect(unsequenced(body), body).toBe('ub.unsequenced');
    }
    const fine = (body: string) => run(main(`int i = 1, j = 0; ${body} return i + j;`));
    for (const body of [
      'i = i + 1;',
      'i += i;',
      'i++, i++;',
      'j = i++ && i;',
      'j = i++ || i;',
      'j = i++ ? i : 0;',
      'i = (i++, 5);',
      'j = (0 ? i++ : 0) + i;',
      'j = (0 && i++) + i;',
      'j = i++ + j;',
      'i = i++ ? 3 : 4;',
    ]) {
      expect(fine(body).diagnostic, body).toBeUndefined();
    }
    // A call's arguments are unsequenced; its value comes after them.
    const sub = 'int sub(int a, int b) { return a - b; }\n';
    expect(ub(`${sub}${main('int i = 0; return sub(i++, i);')}`)?.code).toBe('ub.unsequenced');
    expect(ub(`${sub}${main('int i = 0; return sub(i++, i++);')}`)?.code).toBe('ub.unsequenced');
    expect(run(`${sub}${main('int i = 2; i = sub(i++, 1); return i;')}`).status).toBe(1);
    // Another call's evaluation of the same full expression starts afresh.
    expect(
      run(`int f(int n) { int i = n; i = i + 1; return i; }\n${main('return f(1) + f(2);')}`)
        .status,
    ).toBe(5);
    // A loop's test is checked on each evaluation, separately.
    expect(run(main('int i = 0; while (i++ < 3 && i) ; return i;')).status).toBe(4);
  });

  it('orders the left operand of && and || first only when the right one is evaluated', () => {
    // Short-circuited, no sequence point follows `i++`: it is unsequenced with the `=`.
    expect(ub(main('int i = 0; i = (i++ && 1); return i;'))?.code).toBe('ub.unsequenced');
    expect(ub(main('int i = 1; i = (i++ || 0); return i;'))?.code).toBe('ub.unsequenced');
    // Evaluated, the right operand comes after a sequence point.
    expect(run(main('int i = 1; i = (i++ && 1); return i;')).status).toBe(1);
    expect(run(main('int i = 0; i = (i++ || 0); return i;')).status).toBe(0);
  });

  it('checks each evaluation of a full expression, in its own frame', () => {
    // Each iteration evaluates the full expression again, from no access.
    expect(
      run(
        main(
          'int i = 0, j = 0; for (int k = 0; k < 2; k++) j += (k == 0 ? i++ : 0) + (k == 1 ? i : 0); return j;',
        ),
      ).status,
    ).toBe(1);
    // A recursive call's accesses are to its own variables.
    expect(
      run(
        'int f(int n) {\n  int i = n;\n  return (n ? (i++, f(n - 1)) : 0) + (n ? 0 : i);\n}\nint main(void) { return f(1); }\n',
      ).status,
    ).toBe(0);
  });

  it('stops where the value of a call that ended without return is used', () => {
    const text = `int f(void) {\n}\nint main(void) {\n  return f() + 1;\n}\n`;
    expect(ub(text)).toEqual({
      code: 'ub.missing_return',
      args: { function: 'f' },
      range: at(4, 10, 13),
      stack: { frames: [{ function: 'main', range: at(4, 10, 13) }], total: 1 },
    });
    // Unused, the value is not an error; nor is the end of main.
    expect(run(`int f(void) { }\n${main('f(); (f(), 1); return 0;')}`).status).toBe(0);
  });

  it('lists the stack innermost first, up to the frames listed limit', () => {
    const text =
      'int f(int n) {\n  return n ? f(n - 1) : 1 / n;\n}\nint main(void) {\n  return f(3);\n}\n';
    const call = at(2, 14, 22);
    expect(ub(text)?.stack).toEqual({
      frames: [
        { function: 'f', range: at(2, 25, 30) },
        { function: 'f', range: call },
        { function: 'f', range: call },
        { function: 'f', range: call },
        { function: 'main', range: at(5, 10, 14) },
      ],
      total: 5,
    });
    expect(ub(text, { frames: 2 })?.stack).toEqual({
      frames: [
        { function: 'f', range: at(2, 25, 30) },
        { function: 'f', range: call },
      ],
      total: 5,
    });
    // `limit.steps` during the run has the stack too.
    expect(ub(main('while (1) ;'), { steps: 20 })?.stack?.frames[0]?.function).toBe('main');
  });
});
