import { describe, expect, it } from 'vitest';
import { LIMITS, Run } from '../../src';

describe('Run', () => {
  it('counts every file toward the source size, in UTF-8 bytes', () => {
    // Two files of 6 and 4 bytes ('ñ' is 2): 10 bytes in all.
    const files = [
      { name: 'a.c', text: 'añbcd' },
      { name: 'b.c', text: 'efgh' },
    ];
    const over = new Run({ files, limits: { ...LIMITS, source: 9 } });
    expect(over.advance(1)).toEqual({
      state: 'ended',
      end: { reason: 'diagnostic', diagnostic: { code: 'limit.source', args: { limit: 9 } } },
    });
    const atLimit = new Run({ files, limits: { ...LIMITS, source: 10 } });
    // At the limit the run goes on, to the parser's first error.
    expect(atLimit.advance(100)).toMatchObject({
      end: { diagnostic: { code: 'syntax.expected_type' } },
    });
  });

  it('checks after parsing, with the same end whatever the slice size', () => {
    const files = [{ name: 'main.c', text: 'int f(int x) {\n  return x + 1;\n}\n' }];
    const end = (steps: number, slice: number) => {
      const run = new Run({ files, limits: { ...LIMITS, steps } });
      for (;;) {
        const state = run.advance(slice);
        if (state.state === 'ended') return state.end;
      }
    };
    // 28 steps check the whole program: the checker's error ends it.
    for (const slice of [1, 2, 3, 7, 1000]) {
      expect(end(28, slice)).toEqual({
        reason: 'diagnostic',
        diagnostic: { code: 'name.missing_main', args: {} },
      });
    }
    // One step fewer runs out on the last node the checker visits: the `1` on line 2.
    for (const slice of [1, 3, 1000]) {
      expect(end(27, slice)).toEqual({
        reason: 'diagnostic',
        diagnostic: {
          code: 'limit.steps',
          args: { limit: 27 },
          range: { file: 'main.c', start: { line: 2, column: 14 }, end: { line: 2, column: 15 } },
        },
      });
    }
  });

  it('runs the program after checking it, and ends with its exit status', () => {
    const files = [{ name: 'main.c', text: 'int main(void) {\n  return 258;\n}\n' }];
    for (const slice of [1, 1000]) {
      const run = new Run({ files, limits: LIMITS });
      let state = run.advance(slice);
      while (state.state === 'running') state = run.advance(slice);
      expect(state).toEqual({ state: 'ended', end: { reason: 'exit', status: 2 } });
    }
  });

  it('cuts the function names of a diagnostic stack at the text length', () => {
    const text = 'int abcdefgh(int z) { return 1 / z; }\nint main(void) { return abcdefgh(0); }\n';
    const run = new Run({ files: [{ name: 'main.c', text }], limits: { ...LIMITS, text: 5 } });
    let state = run.advance(1000);
    while (state.state === 'running') state = run.advance(1000);
    expect(state).toMatchObject({
      end: {
        diagnostic: {
          code: 'ub.division_by_zero',
          stack: { frames: [{ function: 'abcd…' }, { function: 'main' }], total: 2 },
        },
      },
    });
  });

  it('keeps its end once ended', () => {
    const run = new Run({
      files: [{ name: 'main.c', text: 'xx' }],
      limits: { ...LIMITS, source: 1 },
    });
    const first = run.advance(1);
    expect(run.advance(1)).toEqual(first);
  });

  it('cuts string args past the text length, by characters', () => {
    const run = new Run({
      files: [{ name: 'main.c', text: `int n = ${'9'.repeat(30)};` }],
      limits: { ...LIMITS, text: 5 },
    });
    expect(run.advance(100)).toMatchObject({
      end: { diagnostic: { code: 'syntax.constant_too_large', args: { number: '9999…' } } },
    });
    const pairs = new Run({
      files: [{ name: 'main.c', text: '1😀😀😀' }],
      limits: { ...LIMITS, text: 3 },
    });
    expect(pairs.advance(100)).toMatchObject({
      end: { diagnostic: { code: 'syntax.invalid_number', args: { number: '1😀…' } } },
    });
    const atLimit = new Run({
      files: [{ name: 'main.c', text: '1😀😀' }],
      limits: { ...LIMITS, text: 3 },
    });
    expect(atLimit.advance(100)).toMatchObject({
      end: { diagnostic: { args: { number: '1😀😀' } } },
    });
  });
});
