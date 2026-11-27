import type { Diagnostic, Range } from 'engine';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Console } from './components/Console';
import { Divider, EDITOR_START } from './components/Divider';
import { Editor, type EditorHandle, type Marker } from './components/Editor';
import { Settings } from './components/Settings';
import { statusText, TopBar } from './components/TopBar';
import { formatNumber, messageOf } from './diagnostics';
import { HELLO_WORLD } from './hello';
import { m } from './paraglide/messages';
import { getLocale, type Locale } from './paraglide/runtime';
import { applyTheme, chooseLocale, chooseTheme, storedTheme, type Theme } from './preferences';
import { isRunShortcut } from './shortcut';
import { useMediaQuery } from './useMediaQuery';
import { type RunControl, type RunStatus, useRun } from './useRun';

/** Below 768 px wide, the editor and the console are two tabs (design/frontend-screens.md#phones). */
export const PHONE = '(max-width: 767.98px)';

type Tab = 'code' | 'console';

/** What the live region says about a run's status, or nothing for a status it does not announce. */
function announcementOf(status: RunStatus): string | undefined {
  switch (status.kind) {
    case 'running':
      // Once per run: not again when the Run button turns into Stop.
      return status.stoppable ? undefined : m.status_running();
    case 'exited':
      return m.console_exited({ status: formatNumber(status.status) });
    case 'stopped':
      return m.console_stopped();
    case 'diagnostic':
      return messageOf(status.diagnostic);
    default:
      return undefined;
  }
}

/** A tab's panel on phones; on desktop the same element, with no tab. */
function panel(phone: boolean, ids: { tab: string; panel: string }) {
  return phone
    ? { id: ids.panel, role: 'tabpanel', 'aria-labelledby': ids.tab }
    : { id: ids.panel };
}

/** The Code and Console tabs on phones; the Console tab carries the run status. */
function PhoneTabs({
  tab,
  onTab,
  status,
  ids,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  status: RunStatus;
  ids: Record<Tab, { tab: string; panel: string }>;
}) {
  const tabs: [Tab, string, string?][] = [
    ['code', m.editor_label()],
    ['console', m.console_label(), statusText(status)],
  ];
  return (
    <div role="tablist" aria-label={m.tabs_label()} className="flex border-b">
      {tabs.map(([each, label, detail]) => (
        <button
          key={each}
          type="button"
          role="tab"
          id={ids[each].tab}
          aria-selected={tab === each}
          aria-controls={ids[each].panel}
          tabIndex={tab === each ? 0 : -1}
          className={`${each === 'code' ? 'flex-none' : 'flex-1'} -mb-px min-w-0 truncate border-b-2 border-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-selected:border-primary aria-selected:font-medium`}
          onClick={() => onTab(each)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const other: Tab = each === 'code' ? 'console' : 'code';
            onTab(other);
            document.getElementById(ids[other].tab)?.focus();
          }}
        >
          {label}
          {detail !== undefined && (
            <>
              {' · '}
              <span className="text-muted-foreground">{detail}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/** The one page: the top bar, then the editor and the console, side by side or as tabs. */
export function App({ runner }: { runner: RunControl }) {
  const code = useRef(HELLO_WORLD);
  const editor = useRef<EditorHandle>(null);
  const area = useRef<HTMLElement>(null);
  const { status, output, start, stop } = useRun(runner);
  /** The diagnostic marked in the editor: until the code changes or the next run starts. */
  const [marked, setMarked] = useState<Diagnostic>();
  const [locale, setLocale] = useState<Locale>(getLocale);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  /** The editor's share of the width, in percent. */
  const [split, setSplit] = useState(EDITOR_START);
  const phone = useMediaQuery(PHONE);
  const [tab, setTab] = useState<Tab>('code');
  /** The live region's text; the count makes the same text twice a new announcement. */
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  const id = useId();
  const ids = {
    code: { tab: `${id}-code-tab`, panel: `${id}-code` },
    console: { tab: `${id}-console-tab`, panel: `${id}-console` },
  };

  useLayoutEffect(() => applyTheme(theme), [theme]);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = m.app_name();
  }, [locale]);

  useEffect(() => {
    if (status.kind === 'diagnostic' && status.diagnostic.range !== undefined) {
      setMarked(status.diagnostic);
    }
    const text = announcementOf(status);
    if (text !== undefined) setAnnouncement((before) => ({ text, count: before.count + 1 }));
  }, [status]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the message is translated, so it follows the language.
  const marker = useMemo<Marker | undefined>(
    () =>
      marked?.range === undefined ? undefined : { range: marked.range, message: messageOf(marked) },
    [marked, locale],
  );

  const run = () => {
    setMarked(undefined);
    if (phone) setTab('console');
    start(code.current);
  };
  const reveal = (range: Range) => {
    // On phones the editor shows first, so it can take the focus.
    if (phone) flushSync(() => setTab('code'));
    editor.current?.reveal(range);
  };

  // Ctrl+Enter anywhere on the page, before CodeMirror's own binding for those keys sees it.
  const latest = useRef({ status, run, stop });
  latest.current = { status, run, stop };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isRunShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      // A held key repeats; it would turn a Run into a Stop a second later.
      if (event.repeat) return;
      const { status, run, stop } = latest.current;
      if (status.kind !== 'running') run();
      else if (status.stoppable) stop();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        status={status}
        showStatus={!phone}
        onRun={run}
        onStop={stop}
        settings={
          <Settings
            locale={locale}
            theme={theme}
            onLocale={(next) => {
              chooseLocale(next);
              setLocale(next);
            }}
            onTheme={(next) => {
              chooseTheme(next);
              setTheme(next);
            }}
          />
        }
      />
      {phone && <PhoneTabs tab={tab} onTab={setTab} status={status} ids={ids} />}
      <main ref={area} className="flex min-h-0 flex-1">
        <div
          {...panel(phone, ids.code)}
          hidden={phone && tab !== 'code'}
          className={phone ? 'min-w-0 flex-1' : 'min-w-0 shrink-0'}
          style={phone ? undefined : { width: `${split}%` }}
        >
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
        {!phone && <Divider percent={split} onChange={setSplit} area={area} />}
        <div
          {...panel(phone, ids.console)}
          hidden={phone && tab !== 'console'}
          className="min-w-0 flex-1"
        >
          <Console output={output} status={status} onReveal={reveal} />
        </div>
      </main>
      <div aria-live="polite" className="sr-only" data-announcer>
        <p key={announcement.count}>{announcement.text}</p>
      </div>
    </div>
  );
}
