// The console: the program's output as it wrote it, with control and invisible characters as marks,
// then the line that says how the run ended (design/frontend-screens.md#console).
import type { Range } from 'engine';
import { Check, Copy, CornerDownLeft } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatNumber, messageOf, rangeText } from '../diagnostics';
import { m } from '../paraglide/messages';
import { runKeysText } from '../shortcut';
import type { RunStatus } from '../useRun';
import { codePoint, markOf, pieces } from '../visible';
import { Button } from './ui/button';

/** How long the copy button shows that it copied. */
const COPIED_MS = 1500;

/** Text with its special characters as marks, styled apart so they never pass for program text. */
const Visible = memo(function Visible({ text }: { text: string }) {
  return pieces(text).map((piece, i) =>
    typeof piece === 'string' ? (
      piece
    ) : (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a text never move.
        key={i}
        className="special-char"
        title={piece.code < 0x20 || piece.code === 0x7f ? codePoint(piece.code) : undefined}
      >
        {markOf(piece.code)}
      </span>
    ),
  );
});

function RangeLink({ range, onReveal }: { range: Range; onReveal: (range: Range) => void }) {
  return (
    <button
      type="button"
      className="cursor-pointer rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onReveal(range)}
    >
      {rangeText(range)}
    </button>
  );
}

/** The line after the output: the exit status, Stop, or the diagnostic with its call stack. */
function End({ status, onReveal }: { status: RunStatus; onReveal: (range: Range) => void }) {
  switch (status.kind) {
    case 'exited':
      return (
        <p className="end-line text-muted-foreground">
          {m.console_exited({ status: formatNumber(status.status) })}
        </p>
      );
    case 'stopped':
      return <p className="end-line text-muted-foreground">{m.console_stopped()}</p>;
    case 'diagnostic': {
      const { range, stack } = status.diagnostic;
      const more = stack === undefined ? 0 : stack.total - stack.frames.length;
      return (
        <div className="end-line text-destructive">
          <p>
            <Visible text={messageOf(status.diagnostic)} />
            {range !== undefined && (
              <>
                {' '}
                <RangeLink range={range} onReveal={onReveal} />
              </>
            )}
          </p>
          {stack !== undefined && (
            <ol className="ml-4">
              {stack.frames.map((frame, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a stack never changes once shown.
                <li key={i}>
                  <Visible text={m.console_frame({ function: frame.function })} />{' '}
                  <RangeLink range={frame.range} onReveal={onReveal} />
                </li>
              ))}
              {more > 0 && <li>{m.console_more_frames({ count: more })}</li>}
            </ol>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

/** Copies text, also where the Clipboard API is missing (a page served over plain HTTP). */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard !== undefined) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export function Console({
  output,
  status,
  onReveal,
}: {
  /** What the program wrote, in chunks. */
  output: readonly string[];
  status: RunStatus;
  /** Moves the editor to a range. */
  onReveal: (range: Range) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  /** Whether scrolling follows new output: until the user scrolls up from the bottom. */
  const follow = useRef(true);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const started = status.kind !== 'ready';
  const ended = started && status.kind !== 'running';
  const last = output.at(-1);
  const noNewline = ended && last !== undefined && !last.endsWith('\n');

  // A new run follows its output again.
  if (status.kind === 'running' && output.length === 0) follow.current = true;
  // biome-ignore lint/correctness/useExhaustiveDependencies: it scrolls after what is shown changes.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && follow.current) element.scrollTop = element.scrollHeight;
  }, [output, status]);

  return (
    <section
      aria-label={m.console_label()}
      className="relative flex h-full min-h-0 flex-col bg-console"
    >
      {started && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1 right-3 z-10 size-8"
          disabled={output.length === 0}
          aria-label={copied ? m.console_copied() : m.console_copy()}
          title={copied ? m.console_copied() : m.console_copy()}
          onClick={() => {
            copyText(output.join('')).then(
              () => {
                setCopied(true);
                clearTimeout(copiedTimer.current);
                copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
              },
              // A denied clipboard leaves the button as it was; the output can still be selected.
              () => {},
            );
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      )}
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto p-3 pr-12 font-mono text-sm"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
        }}
      >
        {started ? (
          <>
            <pre className="whitespace-pre-wrap break-words font-mono [tab-size:8]">
              {output.map((chunk, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: chunks are only appended.
                <Visible key={i} text={chunk} />
              ))}
              {noNewline && (
                // An icon, not a character: it shows the same in every font, and is never copied.
                <span
                  className="eol-mark"
                  role="img"
                  aria-label={m.console_no_newline()}
                  title={m.console_no_newline()}
                >
                  <CornerDownLeft aria-hidden="true" className="size-[0.95em]" strokeWidth={2.5} />
                </span>
              )}
            </pre>
            {ended && <End status={status} onReveal={onReveal} />}
          </>
        ) : (
          <p className="text-muted-foreground">{m.console_hint({ keys: runKeysText() })}</p>
        )}
      </div>
    </section>
  );
}
