// The library functions that run during the program: `printf`, `putchar` and `puts`
// (design/libc.md). Each one is a generator that charges one step per byte it processes and
// pauses after each, so a long call runs across slices like any other code
// (design/engine.md#execution-model).
import { type Diagnostic, DiagnosticError, type Range } from './diagnostic';
import type { Steps } from './steps';

/** An argument: an `int`, or a string literal's bytes without the terminating null. */
export type Argument = number | Uint8Array;

/** What a library function runs with. */
export interface LibraryCall {
  args: Argument[];
  /** Each argument's range. */
  ranges: Range[];
  /** The call's range. */
  range: Range;
  steps: Steps;
  /** Writes one byte of output, or stops with `limit.output`. */
  write(byte: number, range: Range): void;
}

/** A library function in progress; it ends with its return value. */
export type Task = Generator<void, number, void>;

const PERCENT = 0x25;
const DIGITS = /^[0-9]$/;
const FLAGS = '-+ #0';
const SPECIFIERS = 'diouxXfFeEgGaAcspn%';
/** Each length modifier, with the specifiers C17 allows it on (7.21.6.1p7). */
const LENGTHS: ReadonlyMap<string, string> = new Map([
  ['hh', 'diouxXn'],
  ['h', 'diouxXn'],
  ['l', 'diouxXncsaAeEfFgG'],
  ['ll', 'diouxXn'],
  ['j', 'diouxXn'],
  ['z', 'diouxXn'],
  ['t', 'diouxXn'],
  ['L', 'aAeEfFgG'],
]);

function fail(code: Diagnostic['code'], range: Range, args: Diagnostic['args'] = {}): never {
  throw new DiagnosticError({ code, args, range });
}

/** Pauses, then charges the step of the work that follows. */
function* step(call: LibraryCall): Generator<void, void, void> {
  yield;
  call.steps.charge(1, call.range);
}

/** `putchar`: writes its argument converted to `unsigned char`, and returns that value. */
export function* putchar(call: LibraryCall): Task {
  const byte = unsignedChar(call.args[0] as number);
  yield* step(call);
  call.write(byte, call.range);
  return byte;
}

/** `puts`: writes its string and a newline, and returns what glibc returns, the bytes written. */
export function* puts(call: LibraryCall): Task {
  const bytes = call.args[0] as Uint8Array;
  let written = 0;
  for (; written < bytes.length && bytes[written] !== 0; written++) {
    yield* step(call);
    call.write(bytes[written] as number, call.range);
  }
  yield* step(call);
  call.write(0x0a, call.range);
  return written + 1;
}

/**
 * `printf`: writes its format, checking each conversion as it reaches it (design/libc.md#printf),
 * and returns the bytes written. One step per byte of the format it reads and per byte a
 * conversion writes.
 */
export function* printf(call: LibraryCall): Task {
  const format = call.args[0] as Uint8Array;
  const [formatRange] = call.ranges as [Range];
  let written = 0;
  let next = 1;
  let i = 0;
  const write = function* (byte: number): Generator<void, void, void> {
    yield* step(call);
    call.write(byte, call.range);
    written++;
  };
  while (i < format.length && format[i] !== 0) {
    if (format[i] !== PERCENT) {
      yield* write(format[i] as number);
      i++;
      continue;
    }
    const end = yield* readConversion(call, format, i);
    const bytes = format.subarray(i, end);
    i = end;
    const conversion = decode(bytes);
    if (!isValid(conversion)) fail('ub.format_invalid', formatRange, { conversion });
    if (conversion !== '%d' && conversion !== '%s') {
      fail('unsupported.conversion', formatRange, { conversion });
    }
    if (next >= call.args.length) fail('ub.format_missing_argument', call.range, { conversion });
    const arg = call.args[next] as Argument;
    const argRange = call.ranges[next] as Range;
    next++;
    if (conversion === '%d') {
      if (typeof arg !== 'number') {
        fail('ub.format_mismatch', argRange, { conversion, type: 'char *' });
      }
      for (const digit of String(arg)) yield* write(digit.charCodeAt(0));
    } else {
      if (typeof arg === 'number')
        fail('ub.format_mismatch', argRange, { conversion, type: 'int' });
      for (let j = 0; j < arg.length && arg[j] !== 0; j++) yield* write(arg[j] as number);
    }
  }
  // Extra arguments were evaluated and are ignored, as C17 allows.
  return written;
}

/**
 * Reads the conversion at `start`, one step per byte, and returns where it ends: after `%`, its
 * flags, width, precision and length modifier, and the next character (a whole UTF-8 character,
 * so the conversion reads as written), or at the end of the format.
 */
function* readConversion(
  call: LibraryCall,
  format: Uint8Array,
  start: number,
): Generator<void, number, void> {
  const char = (at: number) =>
    at < format.length && format[at] !== 0 ? String.fromCharCode(format[at] as number) : '';
  let i = start;
  const take = function* (): Generator<void, void, void> {
    yield* step(call);
    i++;
  };
  yield* take();
  while (char(i) !== '' && FLAGS.includes(char(i))) yield* take();
  if (char(i) === '*') yield* take();
  else while (DIGITS.test(char(i))) yield* take();
  if (char(i) === '.') {
    yield* take();
    if (char(i) === '*') yield* take();
    else while (DIGITS.test(char(i))) yield* take();
  }
  const length = ['hh', 'h', 'll', 'l', 'j', 'z', 't', 'L'].find((l) =>
    [...l].every((c, k) => char(i + k) === c),
  );
  for (const _ of length ?? '') yield* take();
  if (char(i) === '') return i;
  const lead = format[i] as number;
  const size =
    lead >= 0xc2 && lead <= 0xdf
      ? 2
      : lead >= 0xe0 && lead <= 0xef
        ? 3
        : lead >= 0xf0 && lead <= 0xf4
          ? 4
          : 1;
  const last = i + size;
  yield* take();
  while (i < last && i < format.length && ((format[i] as number) & 0xc0) === 0x80) yield* take();
  return i;
}

/** UTF-8 bytes as text; when they are not valid UTF-8, each byte past ASCII is U+FFFD. */
function decode(bytes: Uint8Array): string {
  try {
    return decodeURIComponent(
      Array.from(bytes, (b) => `%${b.toString(16).padStart(2, '0')}`).join(''),
    );
  } catch {
    return Array.from(bytes, (b) => (b < 0x80 ? String.fromCharCode(b) : '\uFFFD')).join('');
  }
}

/**
 * Whether a conversion is valid C17 (7.21.6.1p4–p8): a known specifier, `%%` alone, and flags,
 * precision and length modifier only on the specifiers that allow them.
 */
function isValid(conversion: string): boolean {
  const match = /^%([-+ #0]*)(\*|[1-9][0-9]*)?(\.(?:\*|[0-9]*))?(hh|h|ll|l|j|z|t|L)?(.)$/su.exec(
    conversion,
  );
  if (match === null) return false;
  const [, flags = '', width, precision, length, specifier = ''] = match;
  if (!SPECIFIERS.includes(specifier)) return false;
  if (specifier === '%') return conversion === '%%';
  if (specifier === 'n' && (flags !== '' || width !== undefined || precision !== undefined)) {
    return false;
  }
  if (flags.includes('#') && !'oxXaAeEfFgG'.includes(specifier)) return false;
  if (flags.includes('0') && !'diouxXaAeEfFgG'.includes(specifier)) return false;
  if (precision !== undefined && !'diouxXaAeEfFgGs'.includes(specifier)) return false;
  if (length !== undefined && !(LENGTHS.get(length) as string).includes(specifier)) return false;
  return true;
}

/** An `int` converted to `unsigned char`. */
function unsignedChar(value: number): number {
  return ((value % 256) + 256) % 256;
}
