// The UI's side of the Worker protocol (design/worker-protocol.md): one Worker per tab, one run at
// a time, run ids, the Stop timeout, and a Worker that fails to load or crashes.
import type { SourceInput } from 'engine';
import { ENGINE_INTERNAL, type FromWorker, type RunEnded, type ToWorker } from './worker/protocol';

/** How long a Stop may take before the Worker is terminated (provisional, design/limits.md). */
export const STOP_TIMEOUT_MS = 2000;

export interface RunCallbacks {
  output: (text: string) => void;
  /** The run's end; called once, last. */
  ended: (ended: RunEnded) => void;
}

interface Active {
  runId: number;
  callbacks: RunCallbacks;
  stopTimer?: ReturnType<typeof setTimeout>;
}

export class Runner {
  readonly #createWorker: () => Worker;
  #worker: Worker | undefined;
  #active: Active | undefined;
  #lastRunId = 0;

  /** Creates the tab's Worker at once, so it loads while the user writes. */
  constructor(createWorker: () => Worker) {
    this.#createWorker = createWorker;
    this.#worker = this.#spawn();
  }

  get running(): boolean {
    return this.#active !== undefined;
  }

  /** Starts a run; the previous one must have ended. */
  run(files: SourceInput[], callbacks: RunCallbacks): void {
    if (this.#active !== undefined) throw new Error('a run is active');
    // A terminated or discarded Worker is replaced only now, so one that cannot load never
    // restarts in a loop.
    this.#worker ??= this.#spawn();
    const runId = ++this.#lastRunId;
    this.#active = { runId, callbacks };
    this.#post({ type: 'run', runId, files });
  }

  /** Stops the active run; past the timeout, terminates the Worker and ends the run as stopped. */
  stop(): void {
    const active = this.#active;
    if (active === undefined || active.stopTimer !== undefined) return;
    this.#post({ type: 'stop', runId: active.runId });
    active.stopTimer = setTimeout(() => {
      this.#discard();
      this.#finish({ reason: 'stopped' });
    }, STOP_TIMEOUT_MS);
  }

  #spawn(): Worker {
    const worker = this.#createWorker();
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      if (worker === this.#worker) this.#receive(event.data);
    };
    worker.onerror = () => {
      if (worker !== this.#worker) return;
      this.#discard();
      if (this.#active !== undefined) {
        this.#finish({ reason: 'diagnostic', diagnostic: ENGINE_INTERNAL });
      }
    };
    return worker;
  }

  #receive(message: FromWorker): void {
    // Late messages of an earlier run are dropped.
    if (this.#active === undefined || message.runId !== this.#active.runId) return;
    if (message.type === 'output') {
      this.#active.callbacks.output(message.text);
      return;
    }
    const { type: _type, runId: _runId, ...ended } = message;
    this.#finish(ended);
  }

  #post(message: ToWorker): void {
    this.#worker?.postMessage(message);
  }

  #discard(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
  }

  #finish(ended: RunEnded): void {
    const active = this.#active;
    if (active === undefined) return;
    clearTimeout(active.stopTimer);
    this.#active = undefined;
    active.callbacks.ended(ended);
  }
}
