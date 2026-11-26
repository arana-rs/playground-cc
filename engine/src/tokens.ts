// Translation phases 5 to 7 (C17 5.1.1.2): escapes, string literal concatenation, and the
// conversion of preprocessing tokens into tokens.
import { DiagnosticError, type Range, type SyntaxCode } from './diagnostic';
import { isIdentifierCharacter, isNotInitial, type PPToken } from './lexer';
import type { Steps } from './steps';

export const KEYWORDS = [
  ...['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else'],
  ...['enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register'],
  ...['restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef'],
  ...['union', 'unsigned', 'void', 'volatile', 'while', '_Alignas', '_Alignof', '_Atomic', '_Bool'],
  ...['_Complex', '_Generic', '_Imaginary', '_Noreturn', '_Static_assert', '_Thread_local'],
] as const;
export type Keyword = (typeof KEYWORDS)[number];
const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

const DIGRAPHS: Record<string, string> = {
  '<:': '[',
  ':>': ']',
  '<%': '{',
  '%>': '}',
  '%:': '#',
  '%:%:': '##',
};

export type Token = (
  | { kind: 'identifier'; name: string }
  | { kind: 'keyword'; keyword: Keyword }
  | { kind: 'integer'; value: number }
  | { kind: 'character'; value: number }
  /** The bytes of the literal, UTF-8, without the terminating NUL. */
  | { kind: 'string'; bytes: Uint8Array }
  /** Spelled without digraphs: `<:` is `[`. */
  | { kind: 'punctuator'; punctuator: string }
  | { kind: 'eof' }
) & { range: Range };

/** Where tokens come from: the lexer, or the preprocessor's output. */
export interface PPTokenSource {
  next(): PPToken;
}

const INT_MAX = 2n ** 31n - 1n;

/** Each integer type with its largest value on x86-64 Linux (LP64). */
const INTEGER_TYPES = {
  int: INT_MAX,
  'unsigned int': 2n ** 32n - 1n,
  long: 2n ** 63n - 1n,
  'unsigned long': 2n ** 64n - 1n,
  'long long': 2n ** 63n - 1n,
  'unsigned long long': 2n ** 64n - 1n,
};
type IntegerType = keyof typeof INTEGER_TYPES;

const SIMPLE_ESCAPES: Record<string, number> = {
  "'": 0x27,
  '"': 0x22,
  '?': 0x3f,
  '\\': 0x5c,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
};

/** Converts preprocessing tokens into tokens, concatenating adjacent string literals. */
export class TokenStream {
  readonly #source: PPTokenSource;
  readonly #steps: Steps;
  #pending: PPToken | undefined;

  constructor(source: PPTokenSource, steps: Steps) {
    this.#source = source;
    this.#steps = steps;
  }

  next(): Token {
    const token = this.#pull();
    const range = rangeOf(token);
    switch (token.kind) {
      case 'identifier': {
        const name = identifierName(token);
        return KEYWORD_SET.has(name)
          ? { kind: 'keyword', keyword: name as Keyword, range }
          : { kind: 'identifier', name, range };
      }
      case 'number':
        return { kind: 'integer', value: integerValue(token), range };
      case 'character':
        return { kind: 'character', value: characterValue(token), range };
      case 'string':
        return this.#string(token);
      case 'punctuator':
        return { kind: 'punctuator', punctuator: DIGRAPHS[token.text] ?? token.text, range };
      case 'other':
        throw strayError(token);
      case 'eof':
        return { kind: 'eof', range };
      case 'header':
        throw new Error('a header name reached the tokens: only #include reads one');
    }
  }

  #pull(): PPToken {
    const token = this.#pending ?? this.#source.next();
    this.#pending = undefined;
    return token;
  }

  /** A string literal, with every adjacent one after it; joining them charges a step per byte. */
  #string(first: PPToken): Token {
    const parts = [stringBytes(first)];
    let last = first;
    let next = this.#pull();
    while (next.kind === 'string') {
      parts.push(stringBytes(next));
      last = next;
      next = this.#pull();
    }
    this.#pending = next;
    const range = first.logical.file.range(first.start, last.end);
    if (parts.length === 1) return { kind: 'string', bytes: parts[0] as Uint8Array, range };
    const size = parts.reduce((total, part) => total + part.length, 0);
    this.#steps.charge(size, range);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return { kind: 'string', bytes, range };
  }
}

function rangeOf(token: PPToken): Range {
  return token.logical.file.range(token.start, token.end);
}

/** The range of the characters from `start` to `end` of a token's text. */
function partRange(token: PPToken, start: number, end: number): Range {
  return token.logical.range(token.index + start, token.index + end);
}

function syntaxError(
  code: SyntaxCode,
  args: Record<string, string>,
  range: Range,
): DiagnosticError {
  return new DiagnosticError({ code, args, range });
}

function unsupported(construct: string, range: Range): DiagnosticError {
  return new DiagnosticError({ code: 'unsupported.construct', args: { construct }, range });
}

/** An `other` token: an unterminated literal, or a character no token can start with. */
function strayError(token: PPToken): DiagnosticError {
  const quote = /^(?:L|u8|u|U)?(["'])/.exec(token.text)?.[1];
  if (quote === '"') return syntaxError('syntax.unterminated_string', {}, rangeOf(token));
  if (quote === "'") return syntaxError('syntax.unterminated_char', {}, rangeOf(token));
  return syntaxError('syntax.stray_character', { character: token.text }, rangeOf(token));
}

/**
 * A universal character name at `index` of a token's text (`é`, `\U0001F600`), checked
 * against C17 6.4.3: its code point and length.
 */
function universalCharacter(token: PPToken, index: number): { code: number; length: number } {
  const text = token.text;
  const digits = text.charAt(index + 1) === 'u' ? 4 : 8;
  let length = 2;
  while (length < 2 + digits && /^[0-9a-fA-F]$/.test(text.charAt(index + length))) length++;
  const code = Number.parseInt(text.slice(index + 2, index + length), 16);
  const allowed = code >= 0xa0 || code === 0x24 || code === 0x40 || code === 0x60;
  if (length < 2 + digits || !allowed || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) {
    throw syntaxError(
      'syntax.invalid_ucn',
      { ucn: text.slice(index, index + length) },
      partRange(token, index, index + length),
    );
  }
  return { code, length };
}

/** An identifier's name, universal character names replaced by their characters (6.4.2.1). */
function identifierName(token: PPToken): string {
  const text = token.text;
  if (/^[A-Za-z0-9_]*$/.test(text)) return text;
  let name = '';
  for (let i = 0; i < text.length; ) {
    let code: number;
    let length: number;
    if (text.charAt(i) === '\\') ({ code, length } = universalCharacter(token, i));
    else {
      code = text.codePointAt(i) as number;
      length = code > 0xffff ? 2 : 1;
    }
    // Below 0x80 only `$`, `@` and `` ` `` pass 6.4.3, and none of them is allowed here.
    const allowed =
      code < 0x80
        ? text.charAt(i) !== '\\'
        : isIdentifierCharacter(code) && !(i === 0 && isNotInitial(code));
    if (!allowed) {
      throw syntaxError(
        'syntax.invalid_identifier_character',
        { character: text.slice(i, i + length) },
        partRange(token, i, i + length),
      );
    }
    name += String.fromCodePoint(code);
    i += length;
  }
  return name;
}

const DECIMAL_FLOAT =
  /^(?:(?:[0-9]*\.[0-9]+|[0-9]+\.)(?:[eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+)[flFL]?$/;
const HEX_FLOAT = /^0[xX](?:[0-9a-fA-F]*\.[0-9a-fA-F]+|[0-9a-fA-F]+\.?)[pP][+-]?[0-9]+[flFL]?$/;
const INTEGER = /^(?:0[xX]([0-9a-fA-F]+)|0([0-7]*)|([1-9][0-9]*))([uUlL]*)$/;
const SUFFIX = /^(?:[uU](?:ll|LL|[lL])?|(?:ll|LL|[lL])[uU]?)?$/;

/**
 * The value of a preprocessing number that is an integer constant of type `int`, the only kind
 * accepted in 0.1 (design/language.md#supported-by-phase).
 */
function integerValue(token: PPToken): number {
  const text = token.text;
  const range = rangeOf(token);
  const hex = /^0[xX]/.test(text);
  if (/\./.test(text) || (hex ? /[pP]/ : /[eE]/).test(text)) {
    if ((hex ? HEX_FLOAT : DECIMAL_FLOAT).test(text)) throw unsupported('float_constant', range);
    throw syntaxError('syntax.invalid_number', { number: text }, range);
  }
  const match = INTEGER.exec(text);
  const suffix = match?.[4] ?? '';
  if (match === null || !SUFFIX.test(suffix)) {
    throw syntaxError('syntax.invalid_number', { number: text }, range);
  }
  const [, hexDigits, octalDigits, decimalDigits] = match;
  const type = integerType(
    hexDigits !== undefined
      ? digitsValue(hexDigits, 16)
      : octalDigits !== undefined
        ? digitsValue(octalDigits, 8)
        : digitsValue(decimalDigits as string, 10),
    decimalDigits !== undefined,
    suffix.toLowerCase(),
  );
  if (type === undefined) throw syntaxError('syntax.constant_too_large', { number: text }, range);
  if (type.name !== 'int') throw unsupported('non_int_constant', range);
  return Number(type.value);
}

/** The value of digits in a base, or `undefined` when it is past every integer type. */
function digitsValue(digits: string, base: 8 | 10 | 16): bigint | undefined {
  const significant = digits.replace(/^0+/, '');
  if (significant.length > 22) return undefined;
  const prefix = base === 16 ? '0x' : base === 8 ? '0o' : '';
  return significant === '' ? 0n : BigInt(prefix + significant);
}

/** The first type of the constant's list (C17 6.4.4.1) that holds its value. */
function integerType(
  value: bigint | undefined,
  decimal: boolean,
  suffix: string,
): { name: IntegerType; value: bigint } | undefined {
  if (value === undefined) return undefined;
  const unsigned = suffix.includes('u');
  const length = suffix.replace('u', '');
  const candidates: IntegerType[] =
    length === 'll'
      ? ['long long', 'unsigned long long']
      : length === 'l'
        ? ['long', 'unsigned long', 'long long', 'unsigned long long']
        : ['int', 'unsigned int', 'long', 'unsigned long', 'long long', 'unsigned long long'];
  const name = candidates
    .filter((type) =>
      unsigned ? type.startsWith('unsigned') : decimal ? !type.startsWith('unsigned') : true,
    )
    .find((type) => value <= INTEGER_TYPES[type]);
  return name === undefined ? undefined : { name, value };
}

/** The literal's prefix (`L`, `u`, `U`, `u8`), or the empty string. */
function prefixOf(token: PPToken): string {
  return /^(?:L|u8|u|U)?/.exec(token.text)?.[0] ?? '';
}

/**
 * The bytes of a character constant's or string literal's characters, escapes decoded: UTF-8
 * for each character and universal character name, one byte for each octal or hex escape.
 */
function literalBytes(token: PPToken, start: number): number[] {
  const text = token.text;
  const end = text.length - 1;
  const bytes: number[] = [];
  for (let i = start; i < end; ) {
    const char = text.charAt(i);
    if (char !== '\\') {
      const code = text.codePointAt(i) as number;
      const length = code > 0xffff ? 2 : 1;
      pushUtf8(bytes, code);
      i += length;
      continue;
    }
    const next = text.charAt(i + 1);
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      bytes.push(simple);
      i += 2;
    } else if (next === 'u' || next === 'U') {
      const { code, length } = universalCharacter(token, i);
      pushUtf8(bytes, code);
      i += length;
    } else {
      const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4))?.[0];
      const hex = next === 'x' ? /^[0-9a-fA-F]+/.exec(text.slice(i + 2, end))?.[0] : undefined;
      const length =
        octal !== undefined ? 1 + octal.length : hex !== undefined ? 2 + hex.length : 0;
      if (length === 0) {
        const code = text.codePointAt(i + 1) as number;
        const escapeEnd = i + 1 + (code > 0xffff ? 2 : 1);
        throw syntaxError(
          'syntax.invalid_escape',
          { escape: text.slice(i, escapeEnd) },
          partRange(token, i, escapeEnd),
        );
      }
      const spelling = text.slice(i, i + length);
      const value = octal !== undefined ? Number.parseInt(octal, 8) : hexValue(hex as string);
      if (value > 0xff) {
        throw syntaxError(
          'syntax.escape_out_of_range',
          { escape: spelling },
          partRange(token, i, i + length),
        );
      }
      bytes.push(value);
      i += length;
    }
  }
  return bytes;
}

/** Appends a code point's UTF-8 bytes; a lone surrogate is U+FFFD, as `TextEncoder` writes it. */
function pushUtf8(bytes: number[], code: number): void {
  const point = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
  if (point < 0x80) bytes.push(point);
  else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
  else if (point < 0x10000) {
    bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
  } else {
    bytes.push(
      0xf0 | (point >> 18),
      0x80 | ((point >> 12) & 0x3f),
      0x80 | ((point >> 6) & 0x3f),
      0x80 | (point & 0x3f),
    );
  }
}

/** A hex escape's value, capped just past a byte so long ones stay cheap. */
function hexValue(digits: string): number {
  const significant = digits.replace(/^0+/, '');
  return significant.length > 2 ? 0x100 : Number.parseInt(significant || '0', 16);
}

/**
 * A character constant's value: an `int`, as GCC computes it on x86-64. One byte is a signed
 * `char`; several make a multi-character constant, each byte shifted in, the last four kept.
 */
function characterValue(token: PPToken): number {
  const prefix = prefixOf(token);
  if (prefix !== '') throw unsupported('wide_char', rangeOf(token));
  const bytes = literalBytes(token, 1);
  if (bytes.length === 0) throw syntaxError('syntax.empty_char_constant', {}, rangeOf(token));
  if (bytes.length === 1) return ((bytes[0] as number) << 24) >> 24;
  return bytes.reduce((value, byte) => (value << 8) | byte, 0);
}

function stringBytes(token: PPToken): Uint8Array {
  if (prefixOf(token) !== '') throw unsupported('wide_char', rangeOf(token));
  return Uint8Array.from(literalBytes(token, 1));
}
