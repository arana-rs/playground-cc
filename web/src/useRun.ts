// The state of the runs: the status the top bar shows and the output the console shows.
import type { Diagnostic, SourceInput } from 'engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunCallbacks } from './runner';
import type { RunEnded } from './worker/protocol';

/** What the UI needs of the Runner. */
export interface RunControl {
  run(files: SourceInput[], callbacks: RunCallbacks): void;
  stop(): void;
}

/**
 * How long a run lasts before the Run button turns into Stop, so a short run does not flash it
 * (design/frontend-screens.md#desktop).
 */
export const STOP_DELAY_MS = 1000;

export type RunStatus =
  | { kind: 'ready' }
  /** `stoppable` once the run has lasted {@link STOP_DELAY_MS}. */
  | { kind: 'running'; stoppable: boolean }
  | { kind: 'exited'; status: number }
  | { kind: 'stopped' }
  | { kind: 'diagnostic'; diagnostic: Diagnostic };

function ended(end: RunEnded): RunStatus {
  switch (end.reason) {
    case 'exit':
      return { kind: 'exited', status: end.status };
    case 'stopped':
      return { kind: 'stopped' };
    case 'diagnostic':
      return { kind: 'diagnostic', diagnostic: end.diagnostic };
  }
}

/**
 * The size past which new output starts a new chunk, so a write re-renders only the last chunk and
 * a large output never re-renders whole.
 */
export const CHUNK_SIZE = 4096;

/** Appends text to the output's chunks, as a new array; empty text changes nothing. */
export function append(chunks: readonly string[], text: string): readonly string[] {
  if (text === '') return chunks;
  const last = chunks.at(-1);
  if (last !== undefined && last.length < CHUNK_SIZE) return [...chunks.slice(0, -1), last + text];
  return [...chunks, text];
}

export function useRun(runner: RunControl) {
  const [status, setStatus] = useState<RunStatus>({ kind: 'ready' });
  /** What the program wrote, in chunks. */
  const [output, setOutput] = useState<readonly string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const start = useCallback(
    (code: string) => {
      setOutput([]);
      setStatus({ kind: 'running', stoppable: false });
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () =>
          setStatus((now) => (now.kind === 'running' ? { kind: 'running', stoppable: true } : now)),
        STOP_DELAY_MS,
      );
      runner.run([{ name: 'main.c', text: code }], {
        output: (text) => setOutput((before) => append(before, text)),
        ended: (end) => {
          clearTimeout(timer.current);
          setStatus(ended(end));
        },
      });
    },
    [runner],
  );
  const stop = useCallback(() => runner.stop(), [runner]);

  return { status, output, start, stop };
}
