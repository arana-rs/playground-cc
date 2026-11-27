// The state of the runs: the status the top bar shows and the output the console shows.
import type { Diagnostic, SourceInput } from 'engine';
import { useCallback, useState } from 'react';
import type { RunCallbacks } from './runner';
import type { RunEnded } from './worker/protocol';

/** What the UI needs of the Runner. */
export interface RunControl {
  run(files: SourceInput[], callbacks: RunCallbacks): void;
  stop(): void;
}

export type RunStatus =
  | { kind: 'ready' }
  | { kind: 'running' }
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

export function useRun(runner: RunControl) {
  const [status, setStatus] = useState<RunStatus>({ kind: 'ready' });
  const [output, setOutput] = useState('');

  const start = useCallback(
    (code: string) => {
      setOutput('');
      setStatus({ kind: 'running' });
      runner.run([{ name: 'main.c', text: code }], {
        output: (text) => setOutput((before) => before + text),
        ended: (end) => setStatus(ended(end)),
      });
    },
    [runner],
  );
  const stop = useCallback(() => runner.stop(), [runner]);

  return { status, output, start, stop };
}
