// Translation phases 1 to 3 (C17 5.1.1.2): trigraphs, line splicing, then preprocessing tokens.
import { DiagnosticError, type Range } from './diagnostic';
import type { SourceFile } from './source';
import type { Steps } from './steps';

export type PPTokenKind =
  | 'identifier'
  | 'number'
  | 'character'
  | 'string'
  | 'punctuator'
  | 'header'
  | 'other'
  | 'eof';

/** A preprocessing token. Its text is spelled after phases 1 and 2. */
export interface PPToken {
  kind: PPTokenKind;
  text: string;
  /** Where the token starts in the source after phases 1 and 2. */
  logical: LogicalText;
  index: number;
  /** Offsets of the token in the file as written: `end` is exclusive. */
  start: number;
  end: number;
  /** The first token of its line, so a directive can start with it. */
  lineStart: boolean;
  /** Whitespace or a comment comes before it. */
  spaceBefore: boolean;
}

const TRIGRAPHS: Record<string, string> = {
  '=': '#',
  '(': '[',
  '/': '\\',
  ')': ']',
  "'": '^',
  '<': '{',
  '!': '|',
  '>': '}',
  '-': '~',
};

/**
 * A file after phases 1 and 2: trigraphs replaced and backslash-newlines removed. Each character
 * keeps the offsets it was written at, for diagnostic ranges.
 */
export class LogicalText {
  readonly text: string;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;

  constructor(readonly file: SourceFile) {
    const source = file.text;
    const chars: string[] = [];
    const starts = new Uint32Array(source.length);
    const ends = new Uint32Array(source.length);
    let i = 0;
    while (i < source.length) {
      let char = source.charAt(i);
      let width = 1;
      if (char === '?' && source.charAt(i + 1) === '?') {
        const replaced = TRIGRAPHS[source.charAt(i + 2)];
        if (replaced !== undefined) {
          char = replaced;
          width = 3;
        }
      }
      if (char === '\\' && source.charAt(i + width) === '\n') {
        i += width + 1;
        continue;
      }
      starts[chars.length] = i;
      ends[chars.length] = i + width;
      chars.push(char);
      i += width;
    }
    this.text = chars.join('');
    this.starts = starts.subarray(0, chars.length);
    this.ends = ends.subarray(0, chars.length);
  }

  /** The offset as written where the character at `index` starts; past the end, the file's end. */
  startOf(index: number): number {
    return index < this.text.length ? (this.starts[index] as number) : this.file.text.length;
  }

  /**
   * The offsets as written of the characters from `start` to `end` (exclusive); an empty span is
   * the point where `start` is.
   */
  span(start: number, end: number): [number, number] {
    const from = this.startOf(start);
    return [from, end > start ? (this.ends[end - 1] as number) : from];
  }

  range(start: number, end: number): Range {
    return this.file.range(...this.span(start, end));
  }
}

/** Punctuators, longest first for the longest match; digraphs are spelled as written. */
const PUNCTUATORS = [
  ['%:%:'],
  ['...', '<<=', '>>='],
  [
    ...['->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||'],
    ...['*=', '/=', '%=', '+=', '-=', '&=', '^=', '|=', '##', '<:', ':>', '<%', '%>', '%:'],
  ],
  [...'[](){}.&*+-~!/%<>^|?:;=,#'],
].map((spellings) => new Set(spellings));

/** The characters C17 allows in identifiers (Annex D.1), as inclusive ranges. */
const IDENTIFIER_RANGES = [
  [0xa8, 0xa8],
  [0xaa, 0xaa],
  [0xad, 0xad],
  [0xaf, 0xaf],
  [0xb2, 0xb5],
  [0xb7, 0xba],
  [0xbc, 0xbe],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0xff],
  [0x100, 0x167f],
  [0x1681, 0x180d],
  [0x180f, 0x1fff],
  [0x200b, 0x200d],
  [0x202a, 0x202e],
  [0x203f, 0x2040],
  [0x2054, 0x2054],
  [0x2060, 0x206f],
  [0x2070, 0x218f],
  [0x2460, 0x24ff],
  [0x2776, 0x2793],
  [0x2c00, 0x2dff],
  [0x2e80, 0x2fff],
  [0x3004, 0x3007],
  [0x3021, 0x302f],
  [0x3031, 0x303f],
  [0x3040, 0xd7ff],
  [0xf900, 0xfd3d],
  [0xfd40, 0xfdcf],
  [0xfdf0, 0xfe44],
  [0xfe47, 0xfffd],
] as const;

/** The characters an identifier may not start with (Annex D.2). */
const NOT_INITIAL_RANGES = [
  [0x300, 0x36f],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
] as const;

function inRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([low, high]) => code >= low && code <= high);
}

/** Annex D.1, planes 1 to 14 included (each without its last two code points). */
export function isIdentifierCharacter(code: number): boolean {
  if (code >= 0x10000) return code <= 0xeffff && (code & 0xffff) <= 0xfffd;
  return inRanges(code, IDENTIFIER_RANGES);
}

export function isNotInitial(code: number): boolean {
  return inRanges(code, NOT_INITIAL_RANGES);
}

const isDigit = (char: string): boolean => char >= '0' && char <= '9';
const isHexDigit = (char: string): boolean => /^[0-9a-fA-F]$/.test(char);
const isLetter = (char: string): boolean => /^[A-Za-z_]$/.test(char);

/** Pulls preprocessing tokens out of one file, charging one step per token. */
export class Lexer {
  readonly #logical: LogicalText;
  readonly #steps: Steps;
  #index = 0;
  #lineStart = true;
  #spaceBefore = false;

  constructor(file: SourceFile, steps: Steps) {
    this.#logical = new LogicalText(file);
    this.#steps = steps;
  }

  /** The next preprocessing token; at the end of the file, an `eof` token, again and again. */
  next(): PPToken {
    this.#skipSpace(false);
    const start = this.#index;
    const text = this.#logical.text;
    if (start >= text.length) return this.#token('eof', start, start);
    this.#charge(start);

    const length = this.#identifierLength(start, true);
    if (length > 0) {
      const end = this.#identifierEnd(start + length);
      const prefix = text.slice(start, end);
      const quote = text.charAt(end);
      if (
        (quote === '"' && /^(?:L|u|U|u8)$/.test(prefix)) ||
        (quote === "'" && /^[LuU]$/.test(prefix))
      ) {
        return this.#literal(start, end);
      }
      return this.#token('identifier', start, end);
    }
    const char = text.charAt(start);
    if (isDigit(char) || (char === '.' && isDigit(text.charAt(start + 1)))) {
      return this.#token('number', start, this.#numberEnd(start));
    }
    if (char === '"' || char === "'") return this.#literal(start, start);
    for (const [i, spellings] of PUNCTUATORS.entries()) {
      const end = start + 4 - i;
      if (spellings.has(text.slice(start, end))) return this.#token('punctuator', start, end);
    }
    const code = text.codePointAt(start) as number;
    return this.#token('other', start, start + (code > 0xffff ? 2 : 1));
  }

  /**
   * A header name (`<stdio.h>` or `"file.h"`) on the rest of the current line, for `#include`;
   * `undefined`, with nothing read, when none comes next.
   */
  headerName(): PPToken | undefined {
    if (!this.#skipSpace(true)) return undefined;
    const start = this.#index;
    const text = this.#logical.text;
    const open = text.charAt(start);
    const close = open === '<' ? '>' : open === '"' ? '"' : undefined;
    if (close === undefined) return undefined;
    let end = start + 1;
    while (end < text.length && text.charAt(end) !== close && text.charAt(end) !== '\n') end++;
    // C17 6.4.7: a header name holds at least one character.
    if (text.charAt(end) !== close || end === start + 1) return undefined;
    this.#charge(start);
    return this.#token('header', start, end + 1);
  }

  /**
   * Skips whitespace and comments, each of which counts as a space. With `sameLine`, stops at a
   * newline and returns false there.
   */
  #skipSpace(sameLine: boolean): boolean {
    const text = this.#logical.text;
    for (;;) {
      const char = text.charAt(this.#index);
      if (char === '\n') {
        if (sameLine) return false;
        this.#lineStart = true;
        this.#spaceBefore = true;
        this.#index++;
      } else if (char === ' ' || char === '\t' || char === '\v' || char === '\f' || char === '\r') {
        this.#spaceBefore = true;
        this.#index++;
      } else if (char === '/' && text.charAt(this.#index + 1) === '*') {
        const close = text.indexOf('*/', this.#index + 2);
        if (close === -1) {
          throw new DiagnosticError({
            code: 'syntax.unterminated_comment',
            args: {},
            range: this.#logical.range(this.#index, this.#index + 2),
          });
        }
        this.#spaceBefore = true;
        this.#index = close + 2;
      } else if (char === '/' && text.charAt(this.#index + 1) === '/') {
        const newline = text.indexOf('\n', this.#index);
        this.#spaceBefore = true;
        this.#index = newline === -1 ? text.length : newline;
      } else {
        return true;
      }
    }
  }

  #charge(index: number): void {
    this.#steps.charge(1, this.#logical.range(index, index));
  }

  #token(kind: PPTokenKind, start: number, end: number): PPToken {
    const [from, to] = this.#logical.span(start, end);
    const token: PPToken = {
      kind,
      text: this.#logical.text.slice(start, end),
      logical: this.#logical,
      index: start,
      start: from,
      end: to,
      lineStart: this.#lineStart,
      spaceBefore: this.#spaceBefore,
    };
    this.#index = end;
    this.#lineStart = false;
    this.#spaceBefore = false;
    return token;
  }

  /**
   * The length of the identifier character at `index` (2 for a surrogate pair, 6 or 10 for a
   * universal character name), or 0. With `initial`, digits do not count.
   */
  #identifierLength(index: number, initial: boolean): number {
    const text = this.#logical.text;
    const char = text.charAt(index);
    if (isLetter(char) || (!initial && isDigit(char))) return 1;
    if (char === '\\') {
      const digits = text.charAt(index + 1) === 'u' ? 4 : text.charAt(index + 1) === 'U' ? 8 : 0;
      if (digits === 0) return 0;
      for (let i = index + 2; i < index + 2 + digits; i++) {
        if (!isHexDigit(text.charAt(i))) return 0;
      }
      return 2 + digits;
    }
    const code = text.codePointAt(index);
    if (code === undefined || code < 0x80 || !isIdentifierCharacter(code)) return 0;
    return code > 0xffff ? 2 : 1;
  }

  #identifierEnd(index: number): number {
    let end = index;
    for (let length = this.#identifierLength(end, false); length > 0; ) {
      end += length;
      length = this.#identifierLength(end, false);
    }
    return end;
  }

  /** A preprocessing number: digits, identifier characters, `.`, and signs after `e` or `p`. */
  #numberEnd(start: number): number {
    const text = this.#logical.text;
    let end = start + (text.charAt(start) === '.' ? 2 : 1);
    for (;;) {
      const char = text.charAt(end);
      const sign = text.charAt(end + 1);
      if ('eEpP'.includes(char) && char !== '' && (sign === '+' || sign === '-')) end += 2;
      else if (char === '.' || isDigit(char)) end++;
      else {
        const length = this.#identifierLength(end, false);
        if (length === 0) return end;
        end += length;
      }
    }
  }

  /**
   * A character constant or string literal whose quote is at `quote`. One that ends at a newline
   * or the end of the file is an `other` token running to the end of its line.
   */
  #literal(start: number, quote: number): PPToken {
    const text = this.#logical.text;
    const close = text.charAt(quote);
    let end = quote + 1;
    while (end < text.length) {
      const char = text.charAt(end);
      if (char === close) {
        return this.#token(close === '"' ? 'string' : 'character', start, end + 1);
      }
      if (char === '\n') break;
      end += char === '\\' ? 2 : 1;
    }
    const newline = text.indexOf('\n', quote);
    return this.#token('other', start, newline === -1 ? text.length : newline);
  }
}
