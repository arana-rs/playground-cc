// Ctrl+Enter, or ⌘+Enter on macOS: Run, or Stop (design/frontend.md#shortcuts).
import { m } from './paraglide/messages';

/** Whether the keyboard is a Mac's, where the shortcut takes ⌘ instead of Ctrl. */
function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/** The shortcut for `aria-keyshortcuts`. */
export function runKeys(): string {
  return isMac() ? 'Meta+Enter' : 'Control+Enter';
}

/** The shortcut as the user reads it. */
export function runKeysText(): string {
  return isMac() ? m.keys_run_mac() : m.keys_run();
}

export function isRunShortcut(event: KeyboardEvent): boolean {
  const mac = isMac();
  return (
    event.key === 'Enter' &&
    event.ctrlKey === !mac &&
    event.metaKey === mac &&
    !event.altKey &&
    !event.shiftKey
  );
}
