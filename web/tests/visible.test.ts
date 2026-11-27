import { describe, expect, it } from 'vitest';
import { append, CHUNK_SIZE } from '../src/useRun';
import { markOf, pieces } from '../src/visible';

const ch = (code: number) => String.fromCodePoint(code);

describe('visible marks', () => {
  it('keep text, tabs and newlines, and cut out every special character', () => {
    expect(pieces(`a\tb\nc${ch(0x0d)}d${ch(0x202e)}`)).toEqual([
      'a\tb\nc',
      { code: 0x0d },
      'd',
      { code: 0x202e },
    ]);
    expect(pieces('')).toEqual([]);
    expect(pieces(`${ch(0x1b)}${ch(0x1b)}`)).toEqual([{ code: 0x1b }, { code: 0x1b }]);
  });

  it('cover the C0 and C1 controls, DEL, the separators and the format characters', () => {
    const special = [0x00, 0x08, 0x0b, 0x0c, 0x0d, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0xad, 0x200b];
    special.push(0x200d, 0x2028, 0x2029, 0x202a, 0x2066, 0x2069, 0xfeff, 0xe0001);
    for (const code of special) expect(pieces(ch(code)), code.toString(16)).toEqual([{ code }]);
    for (const code of [0x09, 0x0a, 0x20, 0xa0, 0xe9, 0x2400, 0xfffd, 0x1f600]) {
      expect(pieces(ch(code)), code.toString(16)).toEqual([ch(code)]);
    }
  });

  it('draw C0 controls as their symbols, DEL as its symbol, and the rest as code points', () => {
    expect(markOf(0x00)).toBe(ch(0x2400));
    expect(markOf(0x0d)).toBe(ch(0x240d));
    expect(markOf(0x1b)).toBe(ch(0x241b));
    expect(markOf(0x7f)).toBe(ch(0x2421));
    expect(markOf(0x85)).toBe('U+0085');
    expect(markOf(0x202e)).toBe('U+202E');
    expect(markOf(0xe0001)).toBe('U+E0001');
  });
});

describe('output chunks', () => {
  it('grow the last chunk until it reaches the chunk size, then start another', () => {
    expect(append([], 'ab')).toEqual(['ab']);
    expect(append(['ab'], 'cd')).toEqual(['abcd']);
    const same = ['ab'];
    expect(append(same, '')).toBe(same);
    const full = 'x'.repeat(CHUNK_SIZE);
    expect(append([full], 'y')).toEqual([full, 'y']);
    const chunks = ['a'];
    expect(append(chunks, 'b')).not.toBe(chunks);
    expect(chunks).toEqual(['a']);
  });
});
