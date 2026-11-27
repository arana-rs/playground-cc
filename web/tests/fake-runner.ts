import type { RunCallbacks } from '../src/runner';
import type { RunControl } from '../src/useRun';

/** A Runner stand-in: the test plays the Worker's part through the callbacks it keeps. */
export class FakeRunner implements RunControl {
  readonly runs: { files: { name: string; text: string }[]; callbacks: RunCallbacks }[] = [];
  stops = 0;

  run(files: { name: string; text: string }[], callbacks: RunCallbacks): void {
    this.runs.push({ files, callbacks });
  }

  stop(): void {
    this.stops++;
  }

  get last(): RunCallbacks {
    return this.runs.at(-1)?.callbacks as RunCallbacks;
  }
}
