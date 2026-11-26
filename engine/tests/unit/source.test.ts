import { describe, expect, it } from 'vitest';
import { SourceFile, utf8Length } from '../../src/source';

describe('SourceFile.position', () => {
  const file = new SourceFile('main.c', 'ab\ncd\n\nñ😀x');

  it('is 1-based', () => {
    expect(file.position(0)).toEqual({ line: 1, column: 1 });
    expect(file.position(1)).toEqual({ line: 1, column: 2 });
  });

  it('puts the newline at the end of its line and starts the next one after it', () => {
    expect(file.position(2)).toEqual({ line: 1, column: 3 });
    expect(file.position(3)).toEqual({ line: 2, column: 1 });
    expect(file.position(6)).toEqual({ line: 3, column: 1 });
  });

  it('counts columns in UTF-16 code units', () => {
    // 'ñ' is one unit, '😀' two.
    expect(file.position(7)).toEqual({ line: 4, column: 1 });
    expect(file.position(8)).toEqual({ line: 4, column: 2 });
    expect(file.position(10)).toEqual({ line: 4, column: 4 });
  });

  it('marks the end of the file as a point', () => {
    const end = file.text.length;
    expect(file.range(end, end)).toEqual({
      file: 'main.c',
      start: { line: 4, column: 5 },
      end: { line: 4, column: 5 },
    });
  });
});

describe('SourceFile edge cases', () => {
  it('handles an empty file', () => {
    expect(new SourceFile('main.c', '').position(0)).toEqual({ line: 1, column: 1 });
  });

  it('puts the end of a file ending in a newline on the next line', () => {
    expect(new SourceFile('main.c', 'a\n').position(2)).toEqual({ line: 2, column: 1 });
  });

  it('builds a range across lines', () => {
    expect(new SourceFile('main.c', 'ab\ncd').range(1, 4)).toEqual({
      file: 'main.c',
      start: { line: 1, column: 2 },
      end: { line: 2, column: 2 },
    });
  });
});

describe('utf8Length', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Length('')).toBe(0);
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('ñ')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });

  it('counts a lone surrogate as U+FFFD', () => {
    expect(utf8Length('\ud800')).toBe(3);
    expect(utf8Length('\udc00a')).toBe(4);
    expect(utf8Length('\ud800a')).toBe(4);
    expect(utf8Length('\ud800\ud83d\ude00')).toBe(7);
  });

  it('matches TextEncoder', () => {
    const text = 'int main(void) { puts("¡hola, mundo! 😀"); }';
    expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
  });
});
