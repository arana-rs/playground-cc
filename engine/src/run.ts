import { type Diagnostic, DiagnosticError } from './diagnostic';
import type { Limits } from './limits';
import { SourceFile, utf8Length } from './source';
import { Steps } from './steps';

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
  #end: RunEnd | undefined;

  constructor(options: RunOptions) {
    this.#files = options.files.map((file) => new SourceFile(file.name, file.text));
    this.#limits = options.limits;
    this.#steps = new Steps(options.limits.steps);
  }

  advance(_maxSteps: number): RunState {
    if (this.#end === undefined) {
      try {
        this.#checkSourceSize();
        throw new Error('not implemented yet: the lexer arrives in step 0.0.3');
      } catch (error) {
        if (!(error instanceof DiagnosticError)) throw error;
        this.#end = { reason: 'diagnostic', diagnostic: error.diagnostic };
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
