// The divider between the editor and the console: drag it, or focus it and use the arrow keys
// (design/frontend-screens.md#desktop).
import type { RefObject } from 'react';
import { m } from '../paraglide/messages';

/** The editor's share of the width, in percent: where it starts and how far it goes. */
export const EDITOR_START = 60;
export const EDITOR_MIN = 20;
export const EDITOR_MAX = 80;
/** How far one arrow key press moves the divider, in percent. */
export const DIVIDER_STEP = 5;

const clamp = (percent: number) => Math.min(EDITOR_MAX, Math.max(EDITOR_MIN, percent));

export function Divider({
  percent,
  onChange,
  area,
}: {
  /** The editor's share of the width, in percent. */
  percent: number;
  onChange: (percent: number) => void;
  /** The element the editor and the console share, whose width the percent is of. */
  area: RefObject<HTMLElement | null>;
}) {
  const moveTo = (clientX: number) => {
    const rect = area.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return;
    onChange(clamp(((clientX - rect.left) / rect.width) * 100));
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator with a value is the ARIA pattern for a resizer; <hr> cannot be one.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={m.divider_label()}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={EDITOR_MIN}
      aria-valuemax={EDITOR_MAX}
      tabIndex={0}
      className="w-1.5 shrink-0 cursor-col-resize touch-none bg-border outline-none hover:bg-ring focus-visible:bg-ring"
      onPointerDown={(event) => {
        // Only the main button drags; the others keep their own meaning.
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event.clientX);
      }}
      onKeyDown={(event) => {
        const next = {
          ArrowLeft: percent - DIVIDER_STEP,
          ArrowRight: percent + DIVIDER_STEP,
          Home: EDITOR_MIN,
          End: EDITOR_MAX,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onChange(clamp(next));
      }}
    />
  );
}
