// Translation phase 4 (C17 5.1.1.2) as 0.1 has it: `#include` of the supported standard headers
// and their macros, the null directive and `#error`; every other directive is reported
// (design/language.md#supported-by-phase).
import { DiagnosticError, type Range, type SyntaxCode } from './diagnostic';
import type { Lexer, PPToken, PPTokenKind } from './lexer';
import type { Steps } from './steps';
import type { PPTokenSource } from './tokens';

type MacroBody = readonly (readonly [PPTokenKind, string])[];

/** The standard headers of 0.1 and the macros each defines, as glibc defines them. */
const HEADERS: ReadonlyMap<string, ReadonlyMap<string, MacroBody>> = new Map([
  [
    'stdio.h',
    new Map([
      [
        'EOF',
        [
          ['punctuator', '('],
          ['punctuator', '-'],
          ['number', '1'],
          ['punctuator', ')'],
        ],
      ],
    ]),
  ],
  [
    'stdlib.h',
    new Map([
      ['EXIT_SUCCESS', [['number', '0']]],
      ['EXIT_FAILURE', [['number', '1']]],
    ]),
  ],
]);

/** Directives of a later phase, or not supported at all, with their `unsupported.construct` key. */
const DIRECTIVE_KEYS: ReadonlyMap<string, string> = new Map([
  ['undef', 'undef'],
  ['if', 'conditional_directive'],
  ['ifdef', 'conditional_directive'],
  ['ifndef', 'conditional_directive'],
  ['elif', 'conditional_directive'],
  ['else', 'conditional_directive'],
  ['endif', 'conditional_directive'],
  ['line', 'line_directive'],
  ['pragma', 'pragma'],
]);

/**
 * Runs the directives and expands the headers' macros. An `#include` of a supported header passes
 * on as its `header` token, where the header's declarations start.
 */
export class Preprocessor implements PPTokenSource {
  readonly #lexer: Lexer;
  readonly #steps: Steps;
  readonly #macros = new Map<string, MacroBody>();
  /** Tokens read ahead, or produced by a macro, to hand out before reading more. */
  readonly #queue: PPToken[] = [];

  constructor(lexer: Lexer, steps: Steps) {
    this.#lexer = lexer;
    this.#steps = steps;
  }

  next(): PPToken {
    for (;;) {
      const token = this.#read();
      if (isDirectiveStart(token)) {
        const header = this.#directive(token);
        if (header !== undefined) return header;
      } else if (token.kind === 'identifier' && token.text === '_Pragma') {
        throw this.#pragmaOperator(token);
      } else if (token.kind === 'identifier' && this.#macros.has(token.text)) {
        this.#expand(token, this.#macros.get(token.text) as MacroBody);
      } else {
        return token;
      }
    }
  }

  #read(): PPToken {
    return this.#queue.shift() ?? this.#lexer.next();
  }

  /** A token of the directive being read: inside one, only spaces and tabs separate tokens. */
  #readInDirective(): PPToken {
    const token = this.#read();
    if (!token.lineStart && token.kind !== 'eof' && token.formFeedBefore) {
      throw syntaxError('syntax.directive_whitespace', {}, rangeOf(token, token));
    }
    return token;
  }

  /** The tokens left on the directive's line; the next line's first token waits in the queue. */
  #restOfLine(): PPToken[] {
    const tokens: PPToken[] = [];
    for (let token = this.#readInDirective(); ; token = this.#readInDirective()) {
      if (token.lineStart || token.kind === 'eof') {
        this.#queue.unshift(token);
        return tokens;
      }
      tokens.push(token);
    }
  }

  /** Runs the directive starting at `hash`; returns the header token of an `#include`. */
  #directive(hash: PPToken): PPToken | undefined {
    const name = this.#readInDirective();
    if (name.lineStart || name.kind === 'eof') {
      this.#queue.unshift(name); // the null directive
      return undefined;
    }
    if (name.kind !== 'identifier') {
      throw syntaxError('syntax.invalid_directive', { directive: name.text }, rangeOf(name, name));
    }
    if (name.text === 'include') return this.#include(hash, name);
    if (name.text === 'error') {
      const tokens = this.#restOfLine();
      const message = tokens
        .map((token, i) => (i > 0 && token.spaceBefore ? ' ' : '') + token.text)
        .join('');
      throw new DiagnosticError({
        code: 'directive.error',
        args: { message },
        range: rangeOf(hash, tokens.at(-1) ?? name),
      });
    }
    if (name.text !== 'define' && !DIRECTIVE_KEYS.has(name.text)) {
      throw syntaxError('syntax.invalid_directive', { directive: name.text }, rangeOf(name, name));
    }
    const tokens = this.#restOfLine();
    const [macro, paren] = tokens;
    const key =
      name.text === 'define'
        ? macro?.kind === 'identifier' && paren?.text === '(' && !paren.spaceBefore
          ? 'function_macro'
          : 'define'
        : (DIRECTIVE_KEYS.get(name.text) as string);
    throw unsupported(key, rangeOf(hash, tokens.at(-1) ?? name));
  }

  #include(hash: PPToken, name: PPToken): PPToken {
    const header = this.#lexer.headerName();
    if (header === undefined) {
      const token = this.#readInDirective();
      if (token.lineStart || token.kind === 'eof') {
        throw syntaxError('syntax.invalid_include', {}, rangeOf(hash, name));
      }
      throw syntaxError('syntax.invalid_include', {}, rangeOf(token, token));
    }
    if (!header.lineStart && header.formFeedBefore) {
      throw syntaxError('syntax.directive_whitespace', {}, rangeOf(header, header));
    }
    if (header.text.startsWith('"')) throw unsupported('local_include', rangeOf(hash, header));
    const macros = HEADERS.get(header.text.slice(1, -1));
    if (macros === undefined) {
      throw new DiagnosticError({
        code: 'unsupported.header',
        args: { header: header.text },
        range: rangeOf(header, header),
      });
    }
    const extra = this.#restOfLine();
    const [first] = extra;
    if (first !== undefined) {
      throw syntaxError(
        'syntax.extra_tokens',
        { directive: name.text },
        rangeOf(first, extra.at(-1) as PPToken),
      );
    }
    for (const [macro, body] of macros) this.#macros.set(macro, body);
    return header;
  }

  /**
   * Replaces a macro name with its body: one step per token produced. The tokens take the place
   * of the name they replace.
   */
  #expand(name: PPToken, body: MacroBody): void {
    this.#steps.charge(body.length, rangeOf(name, name));
    const tokens = body.map(
      ([kind, text], i): PPToken => ({
        ...name,
        kind,
        text,
        lineStart: false,
        spaceBefore: i === 0 && name.spaceBefore,
        formFeedBefore: false,
      }),
    );
    this.#queue.unshift(...tokens);
  }

  /** `_Pragma ( string-literal )`, a pragma like `#pragma`: not supported. */
  #pragmaOperator(name: PPToken): DiagnosticError {
    let last = name;
    for (const matches of [
      (token: PPToken) => token.text === '(',
      (token: PPToken) => token.kind === 'string',
      (token: PPToken) => token.text === ')',
    ]) {
      const token = this.#read();
      if (!matches(token)) return unsupported('pragma', rangeOf(name, name));
      last = token;
    }
    return unsupported('pragma', rangeOf(name, last));
  }
}

function isDirectiveStart(token: PPToken): boolean {
  return (
    token.lineStart && token.kind === 'punctuator' && (token.text === '#' || token.text === '%:')
  );
}

function rangeOf(first: PPToken, last: PPToken): Range {
  return first.logical.file.range(first.start, last.end);
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
