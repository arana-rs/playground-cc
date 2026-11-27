import { m } from '../paraglide/messages';

/** The program's output, or before the first run a hint saying how to run. */
export function Console({ output, started }: { output: string; started: boolean }) {
  return (
    <section
      aria-label={m.console_label()}
      className="h-full min-h-0 overflow-auto bg-muted/40 p-3 font-mono text-sm"
    >
      {started ? (
        <pre className="whitespace-pre-wrap break-words font-mono">{output}</pre>
      ) : (
        <p className="text-muted-foreground">{m.console_hint()}</p>
      )}
    </section>
  );
}
