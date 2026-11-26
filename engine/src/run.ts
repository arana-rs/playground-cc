import { type Diagnostic, DiagnosticError } from './diagnostic';
import { Lexer } from './lexer';
import type { Limits } from './limits';
import { SourceFile, utf8Length } from './source';
import { Steps } from './steps';
import { TokenStream } from './tokens';

export interface SourceInput {
  name: string;
  text: string;
}

export interface RunOptions {
  files: SourceInput[];
  limits: Readonly<Limits>;
}

/** How a run ended: on its own with an exit status, or with a diagnostic. */
export type RunEnd =
  | { reason: 'exit'; status: number }
  | { reason: 'diagnostic'; diagnostic: Diagnostic };

export type RunState = { state: 'running' } | { state: 'ended'; end: RunEnd };

/**
 * One run of a program. The caller advances it in slices of steps; between two calls the run
 * keeps its whole state. An exception thrown by `advance` is a bug in the engine.
 */
export class Run {
  readonly #steps: Steps;
  readonly #files: SourceFile[];
  readonly #limits: Readonly<Limits>;
  #tokens: TokenStream | undefined;
  #end: RunEnd | undefined;

  constructor(options: RunOptions) {
    this.#files = options.files.map((file) => new SourceFile(file.name, file.text));
    this.#limits = options.limits;
    this.#steps = new Steps(options.limits.steps);
  }

  /** Advances the run by about `maxSteps` steps: one piece of work may take it a little past. */
  advance(maxSteps: number): RunState {
    if (this.#end === undefined) {
      try {
        if (this.#tokens === undefined) {
          this.#checkSourceSize();
          // One file until 0.9 (design/worker-protocol.md).
          const file = this.#files[0];
          if (file === undefined) throw new Error('a run needs a file');
          this.#tokens = new TokenStream(new Lexer(file, this.#steps), this.#steps);
        }
        const stop = this.#steps.used + maxSteps;
        while (this.#steps.used < stop) {
          if (this.#tokens.next().kind === 'eof') {
            throw new Error('not implemented yet: the preprocessor arrives in step 0.0.4');
          }
        }
        return { state: 'running' };
      } catch (error) {
        if (!(error instanceof DiagnosticError)) throw error;
        this.#end = {
          reason: 'diagnostic',
          diagnostic: cutArgs(error.diagnostic, this.#limits.text),
        };
      }
    }
    return { state: 'ended', end: this.#end };
  }

  /** The program output written since the last call, as bytes. */
  takeOutput(): Uint8Array {
    return new Uint8Array(0);
  }

  #checkSourceSize(): void {
    let size = 0;
    for (const file of this.#files) size += utf8Length(file.text);
    if (size > this.#limits.source) {
      throw new DiagnosticError({ code: 'limit.source', args: { limit: this.#limits.source } });
    }
  }
}

/** The diagnostic with each string arg longer than `length` characters cut to that length, `…` last. */
function cutArgs(diagnostic: Diagnostic, length: number): Diagnostic {
  const args = Object.fromEntries(
    Object.entries(diagnostic.args).map(([name, value]) => {
      if (typeof value !== 'string') return [name, value];
      const characters = Array.from(value);
      return [
        name,
        characters.length > length ? `${characters.slice(0, length - 1).join('')}…` : value,
      ];
    }),
  );
  return { ...diagnostic, args };
}
