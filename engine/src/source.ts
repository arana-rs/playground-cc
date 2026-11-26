import type { Position, Range } from './diagnostic';

/** One source file, with the positions of its offsets (UTF-16 code units, as JavaScript strings). */
export class SourceFile {
  #lineStarts: number[] | undefined;

  constructor(
    readonly name: string,
    readonly text: string,
  ) {}

  /** The 1-based line and column of an offset; lines end at `\n`. */
  position(offset: number): Position {
    const starts = this.#lines();
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (starts[low] as number) + 1 };
  }

  range(start: number, end: number): Range {
    return { file: this.name, start: this.position(start), end: this.position(end) };
  }

  #lines(): number[] {
    if (this.#lineStarts === undefined) {
      const starts = [0];
      for (let i = this.text.indexOf('\n'); i !== -1; i = this.text.indexOf('\n', i + 1)) {
        starts.push(i + 1);
      }
      this.#lineStarts = starts;
    }
    return this.#lineStarts;
  }
}

/** The size of a text in UTF-8 bytes; a lone surrogate counts as U+FFFD (3 bytes). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
