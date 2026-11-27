// Robustness: random and mutated sources, from the corpus cut and recombined, must always end in
// an exit or a diagnostic, never in an exception (design/testing.md#robustness).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, Run } from '../../src';

/** Sources to mutate: every program of the oracle and engine tests. */
const corpus = ['oracle', 'engine'].flatMap((folder) => {
  const dir = join(import.meta.dirname, '..', folder);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.c'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'));
});

/** Pieces a mutation inserts: tokens, edge cases of the lexer, and text in other scripts. */
const PIECES = [
  ...'int void return if else while do for switch case default break continue goto char static'.split(
    ' ',
  ),
  ...'( ) { } [ ] ; , = == + ++ - -- * / % < <= > >= ! && || ? : ... -> . & | ^ ~ << >> #'.split(
    ' ',
  ),
  '#include <stdio.h>\n',
  '#include <stdlib.h>\n',
  '#include <math.h>\n',
  '#define N 3\n',
  '#\n',
  '#error stop\n',
  '\n#',
  'printf("%d %s %y %5d %%", 1, "a");',
  'puts("x");',
  'putchar(-1);',
  'exit(3);',
  'main',
  'x',
  '0',
  '2147483647',
  '2147483648',
  '0x7fffffff',
  '017',
  '1e5',
  '1.5f',
  "'a'",
  "'\\n'",
  "''",
  "'ab'",
  '"\\x41\\0\\377"',
  '"unterminated',
  '/* unterminated',
  '// comment\n',
  '\\u00e9',
  '\\U0001F600',
  '\\\n',
  '??=',
  'ñ',
  '😀',
  '\u0000',
  '\uD800',
  '\r\n',
  '\t',
];

/** A small seeded generator (mulberry32), so a failure reproduces from its seed. */
function random(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * n);
  };
}

const NUMBERS = ['0', '1', '-1', '2', '7', '10', '46341', '65536', '2147483647', '-2147483647 - 1'];
const OPERATORS = '+ - * / % < <= > >= == != && ||'.split(' ');

/**
 * A source made from the corpus by a few random mutations: most keep its lines and tokens whole
 * (swapping, repeating or borrowing lines, changing numbers and operators), so many runs get past
 * checking; the rest cut, insert and truncate anywhere.
 */
function mutate(next: (n: number) => number): string {
  const pick = <T>(items: readonly T[]): T => items[next(items.length)] as T;
  const lines = pick(corpus).split('\n');
  const line = () => next(lines.length);
  const mutations = next(4);
  for (let m = 0; m < mutations; m++) {
    const i = line();
    switch (next(10)) {
      case 0:
        lines.splice(i, 1);
        break;
      case 1:
        lines.splice(i, 0, ...Array(1 + next(3)).fill(lines[i] ?? ''));
        break;
      case 2:
        lines.splice(i, 0, pick(pick(corpus).split('\n')));
        break;
      case 3: {
        const j = line();
        [lines[i], lines[j]] = [lines[j] ?? '', lines[i] ?? ''];
        break;
      }
      case 4:
        lines[i] = (lines[i] ?? '').replace(/\b\d+\b/, () => pick(NUMBERS));
        break;
      case 5:
        lines[i] = (lines[i] ?? '').replace(/[-+*/%<>]=?|==|!=|&&|\|\|/, () => pick(OPERATORS));
        break;
      case 6:
        lines.splice(i, 0, pick(PIECES));
        break;
      case 7: {
        const text = lines[i] ?? '';
        const at = next(text.length + 1);
        lines[i] = text.slice(0, at) + pick(PIECES) + text.slice(at + next(4));
        break;
      }
      case 8: {
        const text = lines[i] ?? '';
        const at = next(text.length + 1);
        lines[i] = text.slice(0, at) + String.fromCharCode(next(0x80)) + text.slice(at);
        break;
      }
      default:
        lines.length = i;
    }
  }
  return lines.join('\n');
}

/** A source of random pieces and characters, not taken from the corpus. */
function noise(next: (n: number) => number): string {
  let text = '';
  for (let count = next(60); count > 0; count--) {
    text += next(3) === 0 ? String.fromCharCode(next(0x80)) : `${PIECES[next(PIECES.length)]} `;
  }
  return text;
}

const RUNS = Number(process.env.ROBUSTNESS_RUNS ?? 3000);
const SEED = Number(process.env.ROBUSTNESS_SEED ?? 1);
/**
 * The seed folded into 32 bits, so a large one (CI passes its run id) still gives each run its own
 * generator: in doubles, a product past 2^53 would round neighboring runs to the same seed.
 */
const SEED32 = (SEED ^ Math.floor(SEED / 2 ** 32)) >>> 0;
/** Time for the runs, ample for a slow machine: a run takes well under a millisecond here. */
const TIMEOUT_MS = Math.max(10_000, RUNS * 5);

describe('robustness', () => {
  it(
    `ends ${RUNS} random and mutated programs in an exit or a diagnostic (seed ${SEED})`,
    () => {
      for (let i = 0; i < RUNS; i++) {
        const next = random((Math.imul(SEED32, 1_000_003) + i) >>> 0);
        const text = next(10) === 0 ? noise(next) : mutate(next);
        // Small slices pause the steps before the run too; large ones run whole programs.
        const slice = next(2) === 0 ? 50 : 5000;
        try {
          const run = new Run({
            files: [{ name: 'main.c', text }],
            limits: { ...LIMITS, steps: 20_000, output: 4096 },
          });
          let state = run.advance(1 + next(slice));
          while (state.state === 'running') {
            run.takeOutput();
            state = run.advance(1 + next(slice));
          }
          expect(['exit', 'diagnostic']).toContain(state.end.reason);
        } catch (error) {
          throw new Error(`run ${i} (seed ${SEED}) threw on:\n${text}\n${String(error)}`, {
            cause: error,
          });
        }
      }
    },
    TIMEOUT_MS,
  );
});
