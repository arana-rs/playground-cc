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
    expect(() => atLimit.advance(1)).toThrow('not implemented yet');
  });

  it('keeps its end once ended', () => {
    const run = new Run({
      files: [{ name: 'main.c', text: 'xx' }],
      limits: { ...LIMITS, source: 1 },
    });
    const first = run.advance(1);
    expect(run.advance(1)).toEqual(first);
  });
});
