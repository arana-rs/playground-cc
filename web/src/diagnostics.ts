// Diagnostics as text: each code's message from the catalogs, with its args, and ranges as line and
// column (design/errors.md#format, design/frontend.md#i18n).
import type { Diagnostic, Range } from 'engine';
import { m } from './paraglide/messages';
import { getLocale } from './paraglide/runtime';

type Message = (params?: Record<string, string>) => string;
const messages = m as unknown as Record<string, Message | undefined>;

/** Args that are counts or sizes, formatted with the locale; every other arg goes as written. */
const NUMBER_ARGS = new Set(['limit', 'position']);

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale()).format(value);
}

/**
 * The message function of a code: `syntax.expected_token` is `diagnostic_syntax_expected_token`.
 * Undefined for a code without a message.
 */
export function messageFunction(code: string): Message | undefined {
  return messages[`diagnostic_${code.replace('.', '_')}`];
}

/**
 * An `unsupported.construct` key: a named construct is translated; a keyword is C, shown as
 * written (design/language.md#before-its-phase).
 */
function construct(key: string): string {
  return messages[`construct_${key}`]?.() ?? m.quoted({ text: key });
}

/** A diagnostic's message, or the generic one with its code when the code has none. */
export function messageOf(diagnostic: Diagnostic): string {
  const message = messageFunction(diagnostic.code);
  if (message === undefined) return m.diagnostic_unknown({ code: diagnostic.code });
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(diagnostic.args)) {
    params[name] =
      name === 'construct'
        ? construct(String(value))
        : typeof value === 'number' && NUMBER_ARGS.has(name)
          ? formatNumber(value)
          : String(value);
  }
  return message(params);
}

/** A range as its start line and column; the file name shows from 0.9 (design/frontend-screens.md#console). */
export function rangeText(range: Range): string {
  return m.console_range({
    line: formatNumber(range.start.line),
    column: formatNumber(range.start.column),
  });
}
