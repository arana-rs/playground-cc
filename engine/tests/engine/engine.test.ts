// Engine tests: each `name.c` here runs through the engine and must end exactly as `name.json`
// says (design/testing.md#engine-tests).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Diagnostic, LIMITS, type Limits, Run } from '../../src';

/** The expected end of a case. `limits` overrides the release's limits for this case only. */
interface Expected {
  limits?: Partial<Limits>;
  output: string;
  diagnostic?: Diagnostic;
  status?: number;
}

const SLICE = 10_000;
const dir = import.meta.dirname;
const cases = readdirSync(dir)
  .filter((name) => name.endsWith('.c'))
  .map((name) => name.slice(0, -2))
  .sort();

function runToEnd(text: string, limits: Limits): Omit<Expected, 'limits'> {
  const run = new Run({ files: [{ name: 'main.c', text }], limits });
  const decoder = new TextDecoder();
  let output = '';
  for (;;) {
    const state = run.advance(SLICE);
    output += decoder.decode(run.takeOutput(), { stream: true });
    if (state.state === 'ended') {
      output += decoder.decode();
      const { end } = state;
      return end.reason === 'exit'
        ? { output, status: end.status }
        : { output, diagnostic: end.diagnostic };
    }
  }
}

describe('engine tests', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const name of cases) {
    it(name, () => {
      const text = readFileSync(join(dir, `${name}.c`), 'utf8');
      const { limits, ...expected } = JSON.parse(
        readFileSync(join(dir, `${name}.json`), 'utf8'),
      ) as Expected;
      expect(runToEnd(text, { ...LIMITS, ...limits })).toEqual(expected);
    });
  }
});
