import { Play, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatNumber } from '../diagnostics';
import { m } from '../paraglide/messages';
import { runKeys, runKeysText } from '../shortcut';
import type { RunStatus } from '../useRun';
import { Button } from './ui/button';

export function statusText(status: RunStatus): string {
  switch (status.kind) {
    case 'ready':
      return m.status_ready();
    case 'running':
      return m.status_running();
    case 'exited':
      return m.status_exited({ status: formatNumber(status.status) });
    case 'stopped':
      return m.status_stopped();
    case 'diagnostic':
      return m.status_diagnostic();
  }
}

/**
 * The name, the Run button, the run status (unless the page shows it elsewhere) and the settings.
 * During a run the button keeps the look of Run but does nothing until the run is stoppable, then
 * it is Stop; it stays one element, so it keeps focus.
 */
export function TopBar({
  status,
  showStatus,
  onRun,
  onStop,
  settings,
}: {
  status: RunStatus;
  showStatus: boolean;
  onRun: () => void;
  onStop: () => void;
  settings: ReactNode;
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
        aria-keyshortcuts={runKeys()}
        title={runKeysText()}
        className="aria-disabled:cursor-progress"
        onClick={stoppable ? onStop : running ? undefined : onRun}
      >
        {stoppable ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
        {stoppable ? m.stop() : m.run()}
      </Button>
      {/* Not live: the page's live region announces the run (design/frontend.md#accessibility). */}
      <output aria-live="off" className="text-muted-foreground text-sm" hidden={!showStatus}>
        {statusText(status)}
      </output>
      <div className="ml-auto">{settings}</div>
    </header>
  );
}
