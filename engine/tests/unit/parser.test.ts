import { describe, expect, it } from 'vitest';
import type { TranslationUnit } from '../../src/ast';
import { type Diagnostic, DiagnosticError } from '../../src/diagnostic';
import { Lexer } from '../../src/lexer';
import { Parser } from '../../src/parser';
import { Preprocessor } from '../../src/preprocessor';
import { SourceFile } from '../../src/source';
import { Steps } from '../../src/steps';
import { TokenStream } from '../../src/tokens';

function parser(text: string, nesting = 256, budget = 1_000_000): { parser: Parser; steps: Steps } {
  const steps = new Steps(budget);
  const lexer = new Lexer(new SourceFile('main.c', text), steps);
  const tokens = new TokenStream(new Preprocessor(lexer, steps), steps);
  return { parser: new Parser(tokens, steps, nesting), steps };
}

/** Parses to the end, pausing every `slice` steps; returns the tree and the pauses. */
function parse(
  text: string,
  slice = 1_000_000,
  nesting = 256,
): { unit: TranslationUnit; pauses: number } {
  const { parser: p, steps } = parser(text, nesting);
  const run = p.parse();
  let pauses = 0;
  for (;;) {
    p.pauseAt = steps.used + slice;
    const result = run.next();
    if (result.done) return { unit: result.value, pauses };
    pauses++;
  }
}

function parseError(text: string, nesting = 256): Diagnostic | undefined {
  try {
    parse(text, 1_000_000, nesting);
  } catch (error) {
    if (error instanceof DiagnosticError) return error.diagnostic;
    throw error;
  }
  return undefined;
}

/** The tree without ranges, to compare shapes. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value instanceof Uint8Array) return Array.from(value);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'range' && key !== 'nameRange')
      .map(([key, item]) => [key, shape(item)]),
  );
}

/** The shape of the only statement of `int main(void) { ... }`. */
function statement(body: string): unknown {
  const [main] = parse(`int main(void) { ${body} }`).unit.items;
  return shape(main?.kind === 'function' ? main.body.items[0] : undefined);
}

function expression(text: string): unknown {
  return (statement(`${text};`) as { expression: unknown }).expression;
}

const construct = (text: string): string | number | undefined => {
  const diagnostic = parseError(text);
  return diagnostic?.code === 'unsupported.construct'
    ? diagnostic.args.construct
    : diagnostic?.code;
};
const inMain = (body: string) => construct(`int main(void) { ${body} }`);

const name = (n: string) => ({ kind: 'name', name: n });
const constant = (value: number) => ({ kind: 'constant', value });

describe('Parser', () => {
  it('parses function definitions, prototypes and includes', () => {
    const { unit } = parse(
      '#include <stdio.h>\nint add(int a, int);\nvoid f() {}\nint main(void) { return 0; }',
    );
    expect(shape(unit.items)).toEqual([
      { kind: 'include', header: 'stdio.h' },
      {
        kind: 'declaration',
        type: { name: 'int' },
        declarators: [
          {
            name: 'add',
            functions: [
              {
                params: [{ type: { name: 'int' }, name: 'a' }, { type: { name: 'int' } }],
                variadic: false,
              },
            ],
          },
        ],
      },
      {
        kind: 'function',
        type: { name: 'void' },
        declarator: { name: 'f', functions: [{ params: [], variadic: false }] },
        body: { kind: 'block', items: [] },
      },
      {
        kind: 'function',
        type: { name: 'int' },
        declarator: { name: 'main', functions: [{ params: [], variadic: false }] },
        body: { kind: 'block', items: [{ kind: 'return', value: constant(0) }] },
      },
    ]);
  });

  it('gives nodes their ranges', () => {
    const { unit } = parse('int main(void) {\n  return 1 + 2;\n}');
    const main = unit.items[0];
    expect(main?.range).toEqual({
      file: 'main.c',
      start: { line: 1, column: 1 },
      end: { line: 3, column: 2 },
    });
    const ret = main?.kind === 'function' ? main.body.items[0] : undefined;
    expect(ret?.kind === 'return' && ret.value?.range).toEqual({
      file: 'main.c',
      start: { line: 2, column: 10 },
      end: { line: 2, column: 15 },
    });
  });

  it('parses declarations with initializers', () => {
    expect(statement('int a = 1, b, c = {2,};')).toEqual({
      kind: 'declaration',
      type: { name: 'int' },
      declarators: [
        { name: 'a', functions: [], init: constant(1) },
        { name: 'b', functions: [] },
        { name: 'c', functions: [], init: { kind: 'list', items: [constant(2)] } },
      ],
    });
    expect(statement('int (x);')).toMatchObject({ declarators: [{ name: 'x', functions: [] }] });
    expect(statement('int f(void), (g)(int);')).toMatchObject({
      declarators: [
        { name: 'f' },
        { name: 'g', functions: [{ params: [{ type: { name: 'int' } }] }] },
      ],
    });
    expect(shape(parse('int f(int, ...);').unit.items[0])).toMatchObject({
      declarators: [{ functions: [{ variadic: true }] }],
    });
  });

  it('follows operator precedence and associativity', () => {
    expect(expression('a = b += 1 + 2 * 3 - 4')).toEqual({
      kind: 'assign',
      operator: '=',
      target: name('a'),
      value: {
        kind: 'assign',
        operator: '+=',
        target: name('b'),
        value: {
          kind: 'binary',
          operator: '-',
          left: {
            kind: 'binary',
            operator: '+',
            left: constant(1),
            right: { kind: 'binary', operator: '*', left: constant(2), right: constant(3) },
          },
          right: constant(4),
        },
      },
    });
    expect(expression('a || b && c == d < e')).toEqual({
      kind: 'binary',
      operator: '||',
      left: name('a'),
      right: {
        kind: 'binary',
        operator: '&&',
        left: name('b'),
        right: {
          kind: 'binary',
          operator: '==',
          left: name('c'),
          right: { kind: 'binary', operator: '<', left: name('d'), right: name('e') },
        },
      },
    });
    expect(expression('a ? b : c ? d : e')).toEqual({
      kind: 'conditional',
      test: name('a'),
      consequent: name('b'),
      alternative: {
        kind: 'conditional',
        test: name('c'),
        consequent: name('d'),
        alternative: name('e'),
      },
    });
    expect(expression('(a, b), c')).toMatchObject({
      operator: ',',
      left: { operator: ',', left: name('a'), right: name('b') },
      right: name('c'),
    });
  });

  it('parses unary, postfix and call expressions', () => {
    expect(expression('-!+x')).toEqual({
      kind: 'unary',
      operator: '-',
      operand: {
        kind: 'unary',
        operator: '!',
        operand: { kind: 'unary', operator: '+', operand: name('x') },
      },
    });
    expect(expression('++i + j--')).toEqual({
      kind: 'binary',
      operator: '+',
      left: { kind: 'increment', operator: '++', prefix: true, operand: name('i') },
      right: { kind: 'increment', operator: '--', prefix: false, operand: name('j') },
    });
    expect(expression('f(1, g(), "s" "t", \'a\')')).toEqual({
      kind: 'call',
      callee: name('f'),
      args: [
        constant(1),
        { kind: 'call', callee: name('g'), args: [] },
        { kind: 'string', bytes: [0x73, 0x74] },
        constant(97),
      ],
    });
  });

  it('parses every statement of 0.1', () => {
    expect(statement('if (a) ; else { b; }')).toEqual({
      kind: 'if',
      test: name('a'),
      consequent: { kind: 'empty' },
      alternative: { kind: 'block', items: [{ kind: 'expression', expression: name('b') }] },
    });
    expect(statement('while (a) break;')).toEqual({
      kind: 'while',
      test: name('a'),
      body: { kind: 'break' },
    });
    expect(statement('do continue; while (a);')).toEqual({
      kind: 'do',
      body: { kind: 'continue' },
      test: name('a'),
    });
    expect(statement('for (int i = 0; i < 3; i++) ;')).toMatchObject({
      kind: 'for',
      init: { kind: 'declaration', declarators: [{ name: 'i' }] },
      test: { operator: '<' },
      step: { kind: 'increment' },
      body: { kind: 'empty' },
    });
    expect(statement('for (;;) ;')).toEqual({ kind: 'for', body: { kind: 'empty' } });
    expect(statement('switch (a) { case 1: default: return; }')).toEqual({
      kind: 'switch',
      test: name('a'),
      body: {
        kind: 'block',
        items: [
          { kind: 'case', value: constant(1), body: { kind: 'default', body: { kind: 'return' } } },
        ],
      },
    });
    expect(statement('\n#include <stdlib.h>\n')).toEqual({ kind: 'include', header: 'stdlib.h' });
  });

  it('reports syntax errors', () => {
    expect(parseError('int main(void) { return 0 }')).toEqual({
      code: 'syntax.expected_token',
      args: { token: ';' },
      range: { file: 'main.c', start: { line: 1, column: 27 }, end: { line: 1, column: 28 } },
    });
    expect(parseError('int main(void) {')).toMatchObject({
      code: 'syntax.expected_token',
      args: { token: '}' },
      range: { start: { line: 1, column: 17 }, end: { line: 1, column: 17 } },
    });
    expect(inMain('return ;;)')).toBe('syntax.expected_expression');
    expect(inMain('x = ;')).toBe('syntax.expected_expression');
    expect(inMain('int x = {};')).toBe('syntax.expected_expression');
    expect(inMain('int 5;')).toBe('syntax.expected_identifier');
    expect(construct('main(void) {}')).toBe('syntax.expected_type');
    expect(construct('int f(int a, b);')).toBe('syntax.expected_type');
    expect(construct('int f(...);')).toBe('syntax.expected_type');
    expect(construct('}')).toBe('syntax.expected_declaration');
    expect(construct('int x(void);;')).toBe('syntax.expected_declaration');
    expect(inMain('if (1) int x;')).toBe('syntax.expected_statement');
    expect(inMain('switch (1) { case 1: int x; }')).toBe('syntax.expected_statement');
    expect(construct('int int x;')).toBe('syntax.invalid_type_specifiers');
    expect(construct('void int f(void);')).toBe('syntax.invalid_type_specifiers');
    expect(parseError('int;')).toMatchObject({
      code: 'syntax.empty_declaration',
      range: { start: { column: 1 }, end: { column: 5 } },
    });
    expect(inMain('do ; for')).toBe('syntax.expected_token');
  });

  it('answers constructs of later phases with their keys', () => {
    expect(parseError('int x;')).toEqual({
      code: 'unsupported.construct',
      args: { construct: 'global_variable' },
      range: { file: 'main.c', start: { line: 1, column: 1 }, end: { line: 1, column: 7 } },
    });
    expect(construct('int f(void), x = 1;')).toBe('global_variable');
    expect(inMain('char c;')).toBe('char');
    expect(inMain('static int x;')).toBe('static');
    expect(inMain('unsigned u;')).toBe('unsigned');
    expect(inMain('const int c = 1;')).toBe('const');
    expect(construct('typedef int t;')).toBe('typedef');
    expect(construct('extern int x;')).toBe('extern');
    expect(parseError('struct point { int x; } p;')).toMatchObject({
      args: { construct: 'struct' },
      range: { start: { column: 1 }, end: { column: 24 } },
    });
    expect(construct('enum e;')).toBe('enum');
    expect(construct('_Static_assert(1, "x");')).toBe('_Static_assert');
    expect(inMain('return sizeof(int);')).toBe('sizeof');
    expect(parseError('int main(void) { return sizeof x; }')).toMatchObject({
      args: { construct: 'sizeof' },
      range: { start: { column: 25 }, end: { column: 33 } },
    });
    expect(inMain('return _Alignof(int);')).toBe('_Alignof');
    expect(inMain('return (int)1;')).toBe('cast');
    expect(parseError('int main(void) { return (int) -x; }')).toMatchObject({
      args: { construct: 'cast' },
      range: { start: { column: 25 }, end: { column: 33 } },
    });
    expect(parseError('int main(void) { return a & b + 1; }')).toMatchObject({
      args: { construct: 'bitwise_operator' },
      range: { start: { column: 25 }, end: { column: 34 } },
    });
    for (const text of ['a | b', 'a ^ b', 'a << 1', 'a >> 1', '~a', 'a &= 1', 'a <<= 1']) {
      expect(inMain(`${text};`)).toBe('bitwise_operator');
    }
    expect(inMain('int a[3];')).toBe('array');
    expect(inMain('a[0] = 1;')).toBe('array');
    expect(construct('int f(int a[]);')).toBe('array');
    expect(inMain('int *p;')).toBe('pointer');
    expect(inMain('return *p;')).toBe('pointer');
    expect(inMain('f(&x);')).toBe('pointer');
    expect(inMain('int (*p);')).toBe('pointer');
    expect(inMain('x.y = 1;')).toBe('member_access');
    expect(inMain('x->y = 1;')).toBe('member_access');
    expect(inMain('int x = { .y = 1 };')).toBe('designated_initializer');
    expect(inMain('int x = { [0] = 1 };')).toBe('designated_initializer');
    expect(inMain('int (*f)(int);')).toBe('function_pointer');
    expect(construct('int g(int f(int));')).toBe('function_pointer');
  });

  it('answers constructs not supported at all with their keys', () => {
    expect(parseError('int main(void) { goto end; }')).toMatchObject({
      args: { construct: 'goto' },
      range: { start: { column: 18 }, end: { column: 27 } },
    });
    expect(inMain('end: ;')).toBe('goto');
    expect(construct('int f(int a, ...) { return a; }')).toBe('variadic_function');
    expect(construct('int f(a) int a; { return a; }')).toBe('old_style_definition');
    expect(inMain('int g(void) { return 1; }')).toBe('extension');
    expect(inMain('return ({ 1; });')).toBe('extension');
    expect(inMain('switch (1) { case 1 ... 3: ; }')).toBe('extension');
    expect(parseError('int f(void) __attribute__((noreturn));')).toMatchObject({
      args: { construct: 'extension' },
      range: { start: { column: 13 }, end: { column: 38 } },
    });
    expect(inMain('__typeof__(1) x;')).toBe('extension');
    expect(inMain('return (int){1};')).toBe('compound_literal');
    expect(inMain('long double d;')).toBe('long_double');
    expect(inMain('double long d;')).toBe('long_double');
    expect(inMain('++(int){1};')).toBe('compound_literal');
    expect(inMain('++(int)x;')).toBe('cast');
    expect(parseError('int main(void) { int **p, q; }')).toMatchObject({
      args: { construct: 'pointer' },
      range: { start: { column: 22 }, end: { column: 25 } },
    });
    expect(parseError('int main(void) {\n  int g(void) { return 1; }\n}')).toMatchObject({
      args: { construct: 'extension' },
      range: { start: { line: 2, column: 3 }, end: { line: 2, column: 28 } },
    });
    expect(parseError('int f(int a, ...) { return a; }')).toMatchObject({
      range: { start: { column: 1 }, end: { column: 32 } },
    });
    expect(inMain('long x;')).toBe('long');
    for (const keyword of [
      'volatile',
      'register',
      'auto',
      'inline',
      '_Noreturn',
      '_Thread_local',
    ]) {
      expect(construct(`${keyword} int f(void);`)).toBe(keyword);
    }
    expect(inMain('_Atomic(int) x;')).toBe('_Atomic');
    expect(inMain('_Alignas(4) int x;')).toBe('_Alignas');
    expect(inMain('return _Generic(1, int: 2);')).toBe('_Generic');
  });

  it('limits nesting, and counts operator chains as nesting', () => {
    const deep = (levels: number) =>
      `int main(void) { return ${'('.repeat(levels)}1${')'.repeat(levels)}; }`;
    expect(parseError(deep(5), 10)).toBeUndefined();
    // The block, the return statement, then each parenthesis: the ninth is level 11.
    expect(parseError(deep(9), 10)).toEqual({
      code: 'limit.nesting',
      args: { limit: 10 },
      range: { file: 'main.c', start: { line: 1, column: 33 }, end: { line: 1, column: 34 } },
    });
    expect(parseError(`int main(void) { return 1${' + 1'.repeat(20)}; }`, 10)?.code).toBe(
      'limit.nesting',
    );
    expect(parseError(`int main(void) ${'{'.repeat(20)}${'}'.repeat(20)}`, 10)?.code).toBe(
      'limit.nesting',
    );
    expect(parseError(`int ${'('.repeat(20)}f${')'.repeat(20)}(void);`, 10)?.code).toBe(
      'limit.nesting',
    );
    // Deep enough to overflow the JavaScript stack of an unlimited recursive parser.
    expect(parseError(deep(100_000).slice(0, 250_000))?.code).toBe('limit.nesting');
  });

  it('charges one step per node and pauses between slices with the same result', () => {
    const text = 'int main(void) { int a = 1; while (a < 10) a = a + 1; return a; }';
    const whole = parse(text);
    const sliced = parse(text, 3);
    expect(whole.pauses).toBe(0);
    expect(sliced.pauses).toBeGreaterThan(5);
    expect(sliced.unit).toEqual(whole.unit);

    const { parser: p, steps } = parser('int f(void);');
    p.pauseAt = Number.POSITIVE_INFINITY;
    p.parse().next();
    // Tokens: int f ( void ) ; — nodes: parameter list, declarator, declaration.
    expect(steps.used).toBe(6 + 3);
  });
});
