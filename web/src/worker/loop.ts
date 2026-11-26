// The Worker loop: runs the engine in slices of steps, yielding between them so a `stop` is handled
// before the next slice, and sends the output of each slice as text (design/architecture.md).
import { LIMITS, Run } from 'engine';
import { ENGINE_INTERNAL, type FromWorker, type RunEnded, type ToWorker } from './protocol';

/** Steps per slice: about 10 ms on the reference (provisional, design/limits.md#worker-tuning). */
export const SLICE_STEPS = 50_000;

interface Active {
  runId: number;
  run: Run;
  /** Decodes the output as streaming UTF-8, so a character split across slices arrives whole. */
  decoder: TextDecoder;
}

export interface WorkerLoopOptions {
  /** Sends a message to the UI. */
  post: (message: FromWorker) => void;
  /** Runs a task after the messages already waiting, as a new task of the event loop. */
  schedule: (task: () => void) => void;
  /** Reports an exception thrown by the engine, a bug in it. */
  report?: (error: unknown) => void;
  slice?: number;
}

export class WorkerLoop {
  readonly #options: WorkerLoopOptions;
  #active: Active | undefined;

  constructor(options: WorkerLoopOptions) {
    this.#options = options;
  }

  handle(message: ToWorker): void {
    switch (message.type) {
      case 'run':
        this.#start(message.runId, message.files);
        return;
      case 'stop':
        // A `stop` that crossed the `ended` of its run is dropped.
        if (this.#active?.runId === message.runId) this.#end(this.#active, { reason: 'stopped' });
        return;
    }
  }

  #start(runId: number, files: Extract<ToWorker, { type: 'run' }>['files']): void {
    // A new run replaces any other: its slices stop.
    this.#active = undefined;
    const decoder = new TextDecoder();
    let run: Run;
    try {
      run = new Run({ files, limits: LIMITS });
    } catch (error) {
      this.#options.report?.(error);
      this.#options.post({
        type: 'ended',
        runId,
        reason: 'diagnostic',
        diagnostic: ENGINE_INTERNAL,
      });
      return;
    }
    const active = { runId, run, decoder };
    this.#active = active;
    this.#options.schedule(() => this.#slice(active));
  }

  #slice(active: Active): void {
    // Stopped, or replaced by another run, since this slice was scheduled.
    if (this.#active !== active) return;
    let ended: RunEnded | undefined;
    try {
      const state = active.run.advance(this.#options.slice ?? SLICE_STEPS);
      if (state.state === 'ended') ended = state.end;
      // The last slice's output and the flush of an incomplete character go in one message.
      this.#output(active, active.decoder.decode(active.run.takeOutput(), { stream: !ended }));
    } catch (error) {
      this.#options.report?.(error);
      ended = { reason: 'diagnostic', diagnostic: ENGINE_INTERNAL };
      // What the slice wrote before the failure still reaches the console, if it can be taken.
      try {
        this.#output(active, active.decoder.decode(active.run.takeOutput(), { stream: true }));
      } catch {}
    }
    if (ended !== undefined) this.#end(active, ended);
    else this.#options.schedule(() => this.#slice(active));
  }

  /** The last output, with the bytes of an incomplete character as U+FFFD, then `ended`. */
  #end(active: Active, ended: RunEnded): void {
    this.#active = undefined;
    this.#output(active, active.decoder.decode());
    this.#options.post({ type: 'ended', runId: active.runId, ...ended });
  }

  #output(active: Active, text: string): void {
    if (text !== '') this.#options.post({ type: 'output', runId: active.runId, text });
  }
}
