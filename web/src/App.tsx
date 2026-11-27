import { useRef } from 'react';
import { Console } from './components/Console';
import { Editor } from './components/Editor';
import { TopBar } from './components/TopBar';
import { HELLO_WORLD } from './hello';
import { m } from './paraglide/messages';
import { type RunControl, useRun } from './useRun';

/** The one page: the top bar, then the editor and the console side by side. */
export function App({ runner }: { runner: RunControl }) {
  const code = useRef(HELLO_WORLD);
  const { status, output, start, stop } = useRun(runner);
  return (
    <div className="flex h-dvh flex-col">
      <TopBar status={status} onRun={() => start(code.current)} onStop={stop} />
      <main className="flex min-h-0 flex-1">
        <div className="w-3/5 min-w-0 border-r">
          <Editor
            initial={HELLO_WORLD}
            label={m.editor_label()}
            onChange={(text) => {
              code.current = text;
            }}
          />
        </div>
        <div className="w-2/5 min-w-0">
          <Console output={output} started={status.kind !== 'ready'} />
        </div>
      </main>
    </div>
  );
}
