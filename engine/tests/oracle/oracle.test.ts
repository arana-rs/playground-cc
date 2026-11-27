// Oracle tests: each `name.c` here must write the bytes of `name.out` and end with the status of
// `name.status`, which `generate.sh` wrote from GCC and Clang builds (design/testing.md#oracle-tests).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, Run, type RunEnd } from '../../src';

const SLICE = 10_000;
const dir = import.meta.dirname;
const cases = readdirSync(dir)
  .filter((name) => name.endsWith('.c'))
  .map((name) => name.slice(0, -2))
  .sort();

function runToEnd(text: string): { output: Buffer; end: RunEnd } {
  const run = new Run({ files: [{ name: 'main.c', text }], limits: LIMITS });
  const chunks: Uint8Array[] = [];
  for (;;) {
    const state = run.advance(SLICE);
    chunks.push(run.takeOutput());
    if (state.state === 'ended') return { output: Buffer.concat(chunks), end: state.end };
  }
}

describe('oracle tests', () => {
  it('has cases, each with its expected results', () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const name of cases) {
      expect(existsSync(join(dir, `${name}.out`)), `${name}.out`).toBe(true);
      expect(existsSync(join(dir, `${name}.status`)), `${name}.status`).toBe(true);
      // Input arrives in 0.4 (design/roadmap.md).
      expect(existsSync(join(dir, `${name}.in`)), `${name}.in`).toBe(false);
    }
    // Expected results of a case that is gone would linger unchecked.
    for (const file of readdirSync(dir).filter((name) => /\.(out|status|in)$/.test(name))) {
      expect(cases, file).toContain(file.replace(/\.[a-z]+$/, ''));
    }
  });

  for (const name of cases) {
    it(name, () => {
      const text = readFileSync(join(dir, `${name}.c`), 'utf8');
      const first = runToEnd(text);
      expect(first.end).toEqual({
        reason: 'exit',
        status: Number(readFileSync(join(dir, `${name}.status`), 'utf8')),
      });
      expect(first.output).toEqual(readFileSync(join(dir, `${name}.out`)));
      // The same program gives the same results on every run (design/README.md#principles).
      const second = runToEnd(text);
      expect(second.end).toEqual(first.end);
      expect(second.output).toEqual(first.output);
    });
  }
});
