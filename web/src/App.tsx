import type { Diagnostic } from 'engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Console } from './components/Console';
import { Editor, type EditorHandle, type Marker } from './components/Editor';
import { TopBar } from './components/TopBar';
import { messageOf } from './diagnostics';
import { HELLO_WORLD } from './hello';
import { m } from './paraglide/messages';
import { type RunControl, useRun } from './useRun';

/** The one page: the top bar, then the editor and the console side by side. */
export function App({ runner }: { runner: RunControl }) {
  const code = useRef(HELLO_WORLD);
  const editor = useRef<EditorHandle>(null);
  const { status, output, start, stop } = useRun(runner);
  /** The diagnostic marked in the editor: until the code changes or the next run starts. */
  const [marked, setMarked] = useState<Diagnostic>();

  useEffect(() => {
    if (status.kind === 'diagnostic' && status.diagnostic.range !== undefined) {
      setMarked(status.diagnostic);
    }
  }, [status]);
  const marker = useMemo<Marker | undefined>(
    () =>
      marked?.range === undefined ? undefined : { range: marked.range, message: messageOf(marked) },
    [marked],
  );

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        status={status}
        onRun={() => {
          setMarked(undefined);
          start(code.current);
        }}
        onStop={stop}
      />
      <main className="flex min-h-0 flex-1">
        <div className="w-3/5 min-w-0 border-r">
          <Editor
            ref={editor}
            initial={HELLO_WORLD}
            label={m.editor_label()}
            readOnly={status.kind === 'running'}
            marker={marker}
            onChange={(text) => {
              code.current = text;
              setMarked(undefined);
            }}
          />
        </div>
        <div className="w-2/5 min-w-0">
          <Console
            output={output}
            status={status}
            onReveal={(range) => editor.current?.reveal(range)}
          />
        </div>
      </main>
    </div>
  );
}
