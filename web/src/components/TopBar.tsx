import { Play, Square } from 'lucide-react';
import { m } from '../paraglide/messages';
import { getLocale } from '../paraglide/runtime';
import type { RunStatus } from '../useRun';
import { Button } from './ui/button';

function statusText(status: RunStatus): string {
  switch (status.kind) {
    case 'ready':
      return m.status_ready();
    case 'running':
      return m.status_running();
    case 'exited':
      return m.status_exited({ status: new Intl.NumberFormat(getLocale()).format(status.status) });
    case 'stopped':
      return m.status_stopped();
    case 'diagnostic':
      return m.status_diagnostic();
  }
}

/**
 * The name, the Run button and the run status. During a run the button keeps the look of Run but
 * does nothing until the run is stoppable, then it is Stop; it stays one element, so it keeps focus.
 */
export function TopBar({
  status,
  onRun,
  onStop,
}: {
  status: RunStatus;
  onRun: () => void;
  onStop: () => void;
}) {
  const running = status.kind === 'running';
  const stoppable = running && status.stoppable;
  return (
    <header className="flex items-center gap-4 border-b px-4 py-2">
      <h1 className="font-semibold">{m.app_name()}</h1>
      <Button
        variant={stoppable ? 'destructive' : 'default'}
        size="sm"
        aria-disabled={running && !stoppable ? true : undefined}
        className="aria-disabled:cursor-progress"
        onClick={stoppable ? onStop : running ? undefined : onRun}
      >
        {stoppable ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
        {stoppable ? m.stop() : m.run()}
      </Button>
      <output className="text-sm text-muted-foreground">{statusText(status)}</output>
    </header>
  );
}
