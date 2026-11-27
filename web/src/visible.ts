// Text that cannot read differently from what it is: control and invisible characters are drawn as
// visible marks, the same in the editor, the console and diagnostic args
// (design/frontend-screens.md#console).

/**
 * Characters drawn as marks: the C0 controls but `\t` and `\n`, DEL, the C1 controls, the line and
 * paragraph separators, and every format character (Unicode's Cf, the bidirectional controls among
 * them).
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
export const SPECIAL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u;

const SPECIALS = new RegExp(SPECIAL.source, 'gu');

/**
 * The mark for a special character: a C0 control as its symbol (U+2400 plus the byte), DEL as `␡`,
 * and any other as its code point, `U+202E`.
 */
export function markOf(code: number): string {
  if (code < 0x20) return String.fromCodePoint(0x2400 + code);
  if (code === 0x7f) return String.fromCodePoint(0x2421);
  return codePoint(code);
}

/** A code point as Unicode writes it: `U+000D`. */
export function codePoint(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Text cut into plain pieces and the special characters between them, in order. */
export type Piece = string | { code: number };

export function pieces(text: string): Piece[] {
  const result: Piece[] = [];
  let at = 0;
  for (const match of text.matchAll(SPECIALS)) {
    if (match.index > at) result.push(text.slice(at, match.index));
    result.push({ code: match[0].codePointAt(0) as number });
    at = match.index + match[0].length;
  }
  if (at < text.length) result.push(text.slice(at));
  return result;
}
