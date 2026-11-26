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
