import { Checker, type Program } from './checker';
import { type Diagnostic, DiagnosticError } from './diagnostic';
import { Interpreter } from './interpreter';
import { Lexer } from './lexer';
import type { Limits } from './limits';
import { Parser } from './parser';
import { Preprocessor } from './preprocessor';
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
  #parser: Parser | undefined;
  #checker: Checker | undefined;
  #beforeRun: Generator<void, Program, void> | undefined;
  #interpreter: Interpreter | undefined;
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
        if (this.#parser === undefined || this.#beforeRun === undefined) {
          this.#checkSourceSize();
          // One file until 0.9 (design/worker-protocol.md).
          const file = this.#files[0];
          if (file === undefined) throw new Error('a run needs a file');
          const lexer = new Lexer(file, this.#steps);
          const tokens = new TokenStream(new Preprocessor(lexer, this.#steps), this.#steps);
          this.#parser = new Parser(tokens, this.#steps, this.#limits.nesting);
          this.#beforeRun = this.#translate(this.#parser);
        }
        const pauseAt = this.#steps.used + maxSteps;
        if (this.#interpreter === undefined) {
          this.#parser.pauseAt = pauseAt;
          if (this.#checker !== undefined) this.#checker.pauseAt = pauseAt;
          const translated = this.#beforeRun.next();
          if (!translated.done) return { state: 'running' };
          this.#interpreter = new Interpreter(translated.value, this.#steps, this.#limits);
        }
        const status = this.#interpreter.advance(pauseAt);
        if (status === undefined) return { state: 'running' };
        this.#end = { reason: 'exit', status };
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

  /** Parsing, then checking: the steps before the run, paused between slices. */
  *#translate(parser: Parser): Generator<void, Program, void> {
    const unit = yield* parser.parse();
    this.#checker = new Checker(unit, this.#steps, this.#limits);
    this.#checker.pauseAt = parser.pauseAt;
    return yield* this.#checker.check();
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

/**
 * The diagnostic with each string arg, and each frame's function name, longer than `length`
 * characters cut to that length, `…` last.
 */
function cutArgs(diagnostic: Diagnostic, length: number): Diagnostic {
  const cut = (value: string): string => {
    const characters = Array.from(value);
    return characters.length > length ? `${characters.slice(0, length - 1).join('')}…` : value;
  };
  const args = Object.fromEntries(
    Object.entries(diagnostic.args).map(([name, value]) => [
      name,
      typeof value === 'string' ? cut(value) : value,
    ]),
  );
  const { stack } = diagnostic;
  return {
    ...diagnostic,
    args,
    ...(stack && {
      stack: { ...stack, frames: stack.frames.map((f) => ({ ...f, function: cut(f.function) })) },
    }),
  };
}
