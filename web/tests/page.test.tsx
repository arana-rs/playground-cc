// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, PHONE } from '../src/App';
import { forgetChoices, LOCALE_KEY, THEME_KEY } from '../src/preferences';
import { STOP_DELAY_MS } from '../src/useRun';
import { FakeRunner } from './fake-runner';
import { setMedia } from './media';

const DARK = '(prefers-color-scheme: dark)';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function page() {
  const runner = new FakeRunner();
  const result = render(<App runner={runner} />);
  const view = EditorView.findFromDOM(
    result.container.querySelector('.cm-editor') as HTMLElement,
  ) as EditorView;
  return { runner, view, ...result };
}

/** A page load after this one: the page's own choices are gone, the stored ones remain. */
function reload() {
  cleanup();
  forgetChoices();
  return page();
}

describe('settings', () => {
  it('open from the button in the bar, as a popover dialog', () => {
    page();
    const button = screen.getByRole('button', { name: 'Settings' });
    // A closed popover has no accessible name in jsdom, so it is found through the button.
    const dialog = document.getElementById(button.getAttribute('popovertarget') ?? '');
    if (dialog === null) throw new Error('the button opens nothing');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Settings');
    expect(dialog.getAttribute('popover')).toBe('auto');
    // The layout sits inside: a display on the popover itself would show it while closed.
    expect(dialog.className).not.toMatch(/\b(flex|grid|block)\b/);
    expect(
      screen.getByRole('radio', { hidden: true, name: 'Español' }).closest('label')?.lang,
    ).toBe('es');
  });

  it('switch the language without reloading, keeping the code, and store it', () => {
    const { view } = page();
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '// mine\n' } });
    });
    fireEvent.click(screen.getByRole('radio', { hidden: true, name: 'Español' }));
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeDefined();
    expect(document.documentElement.lang).toBe('es');
    expect(screen.getByRole('textbox', { name: 'Código' }).textContent).toContain('// mine');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('es');
    reload();
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeDefined();
  });

  it('ignore a stored language or theme outside the allowed values', () => {
    localStorage.setItem(LOCALE_KEY, 'fr');
    localStorage.setItem(THEME_KEY, 'blue');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-AR']);
    setMedia(DARK, true);
    page();
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeDefined();
    expect(screen.getByRole('radio', { hidden: true, name: 'Sistema' })).toHaveProperty(
      'checked',
      true,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keep a choice for the page when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    page();
    fireEvent.click(screen.getByRole('radio', { hidden: true, name: 'Español' }));
    fireEvent.click(screen.getByRole('radio', { hidden: true, name: 'Oscuro' }));
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeDefined();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('set the theme, or follow the system and its changes', () => {
    page();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => setMedia(DARK, true));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { hidden: true, name: 'Light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    fireEvent.click(screen.getByRole('radio', { hidden: true, name: 'Dark' }));
    act(() => setMedia(DARK, false));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { hidden: true, name: 'System' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    reload();
    expect(screen.getByRole('radio', { hidden: true, name: 'System' })).toHaveProperty(
      'checked',
      true,
    );
  });
});

describe('source and licenses', () => {
  it('link to the source of this build and to the third-party licenses, in a new tab', () => {
    page();
    const source = screen.getByRole('link', { hidden: true, name: /^Source code/ });
    const licenses = screen.getByRole('link', { hidden: true, name: /^Licenses/ });
    expect(source.getAttribute('href')).toBe(import.meta.env.VITE_SOURCE_URL);
    expect(source.getAttribute('href')).toMatch(
      /^https:\/\/github\.com\/arana-rs\/playground-cc\/tree\/v\d/,
    );
    expect(licenses.getAttribute('href')).toBe('/THIRD-PARTY-LICENSES.txt');
    for (const link of [source, licenses]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.textContent).toContain('(opens in a new tab)');
    }
  });
});

describe('divider', () => {
  /** The editor's panel: the first in the page's main area. */
  const editorWidth = () => {
    const main = screen.getByRole('textbox', { name: 'Code' }).closest('main') as HTMLElement;
    return (main.firstElementChild as HTMLElement).style.width;
  };

  it('starts at 60% and moves with the arrow keys, Home and End, within 20% to 80%', () => {
    page();
    const divider = screen.getByRole('separator', { name: 'Resize the editor and the console' });
    expect(divider.getAttribute('aria-valuenow')).toBe('60');
    expect(editorWidth()).toBe('60%');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(editorWidth()).toBe('65%');
    fireEvent.keyDown(divider, { key: 'End' });
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('80');
    fireEvent.keyDown(divider, { key: 'Home' });
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(editorWidth()).toBe('20%');
  });

  it('drags only with the main button', () => {
    page();
    const divider = screen.getByRole('separator');
    const capture = vi.fn();
    divider.setPointerCapture = capture;
    fireEvent.pointerDown(divider, { button: 2, pointerId: 1 });
    expect(capture).not.toHaveBeenCalled();
  });

  it('follows the pointer while dragged', () => {
    page();
    const divider = screen.getByRole('separator');
    const main = divider.parentElement as HTMLElement;
    main.getBoundingClientRect = () => ({ left: 100, width: 1000 }) as DOMRect;
    let captured = false;
    divider.setPointerCapture = () => {
      captured = true;
    };
    divider.hasPointerCapture = () => captured;
    fireEvent.pointerMove(divider, { clientX: 500, pointerId: 1 });
    expect(editorWidth()).toBe('60%');
    fireEvent.pointerDown(divider, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 450, pointerId: 1 });
    expect(editorWidth()).toBe('35%');
    fireEvent.pointerMove(divider, { clientX: 1100, pointerId: 1 });
    expect(editorWidth()).toBe('80%');
  });
});

describe('phones', () => {
  beforeEach(() => setMedia(PHONE, true));

  it('show the editor and the console as tabs, with the run status on the Console tab', () => {
    const { runner } = page();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByRole('status', { hidden: true }).hidden).toBe(true);
    const code = screen.getByRole('tab', { name: 'Code' });
    expect(code.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Console · Ready' })).toBeDefined();
    expect(screen.getByRole('tabpanel', { name: 'Code' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const console = screen.getByRole('tab', { name: 'Console · Running' });
    expect(console.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tabpanel', { name: 'Code' })).toBeNull();
    act(() => runner.last.ended({ reason: 'exit', status: 0 }));
    expect(screen.getByRole('tab', { name: 'Console · Exited with status 0' })).toBeDefined();
  });

  it('switch to the Code tab at a diagnostic range, and with the arrow keys', () => {
    const { runner, view } = page();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() =>
      runner.last.ended({
        reason: 'diagnostic',
        diagnostic: {
          code: 'ub.division_by_zero',
          args: {},
          range: { file: 'main.c', start: { line: 2, column: 1 }, end: { line: 2, column: 4 } },
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'line 2, column 1' }));
    expect(screen.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe('true');
    expect(view.state.selection.main.from).toBe(view.state.doc.line(2).from);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Code' }), { key: 'ArrowRight' });
    const console = screen.getByRole('tab', { name: /^Console/ });
    expect(console.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(console);
  });

  it('keep the editor and its code when the window turns wide', () => {
    const { view } = page();
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '// kept\n' } });
    });
    act(() => setMedia(PHONE, false));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Code' }).textContent).toContain('// kept');
  });
});

describe('Ctrl+Enter', () => {
  const press = (target: Element, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(target, { key: 'Enter', ctrlKey: true, ...init });

  it('runs from the editor without inserting a line, then stops once Stop shows', () => {
    vi.useFakeTimers();
    const { runner, view } = page();
    const doc = view.state.doc.toString();
    press(view.contentDOM);
    expect(runner.runs).toHaveLength(1);
    expect(view.state.doc.toString()).toBe(doc);
    press(document.body);
    expect(runner.stops).toBe(0);
    act(() => vi.advanceTimersByTime(STOP_DELAY_MS));
    press(document.body, { repeat: true });
    expect(runner.stops).toBe(0);
    press(document.body);
    expect(runner.stops).toBe(1);
    act(() => runner.last.ended({ reason: 'stopped' }));
    press(screen.getByRole('separator'));
    expect(runner.runs).toHaveLength(2);
  });

  it('ignores other modifiers, and takes ⌘ instead of Ctrl on macOS', () => {
    const { runner } = page();
    press(document.body, { shiftKey: true });
    press(document.body, { ctrlKey: false, metaKey: true });
    expect(runner.runs).toHaveLength(0);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    press(document.body);
    expect(runner.runs).toHaveLength(0);
    press(document.body, { ctrlKey: false, metaKey: true });
    expect(runner.runs).toHaveLength(1);
  });

  it('is named with ⌘ on macOS', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    page();
    const run = screen.getByRole('button', { name: 'Run' });
    expect(run.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter');
    expect(run.title).toBe('⌘+Enter');
    expect(screen.getByRole('region', { name: 'Console' }).textContent).toBe(
      'Press Run or ⌘+Enter to run your program.',
    );
  });

  it('is named in the console hint and on the Run button', () => {
    page();
    expect(screen.getByRole('region', { name: 'Console' }).textContent).toBe(
      'Press Run or Ctrl+Enter to run your program.',
    );
    expect(screen.getByRole('button', { name: 'Run' }).getAttribute('aria-keyshortcuts')).toBe(
      'Control+Enter',
    );
  });
});

describe('live region', () => {
  const live = () => document.querySelector('[data-announcer]') as HTMLElement;

  it('announces when a run starts and ends, and each diagnostic message', () => {
    vi.useFakeTimers();
    const { runner } = page();
    expect(live().textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(live().textContent).toBe('Running');
    const first = live().firstElementChild;
    act(() => vi.advanceTimersByTime(STOP_DELAY_MS));
    expect(live().firstElementChild).toBe(first);
    act(() => runner.last.ended({ reason: 'exit', status: 0 }));
    expect(live().textContent).toBe('Program exited with status 0.');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() =>
      runner.last.ended({
        reason: 'diagnostic',
        diagnostic: { code: 'name.missing_main', args: {} },
      }),
    );
    expect(live().textContent).toBe('The program has no ‘main’ function.');
  });

  it('announces the same text again as a new announcement', () => {
    const { runner } = page();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => runner.last.ended({ reason: 'stopped' }));
    const before = live().firstElementChild;
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => runner.last.ended({ reason: 'stopped' }));
    expect(live().textContent).toBe('Program stopped.');
    expect(live().firstElementChild).not.toBe(before);
  });

  it('leaves the status in the bar silent, so a run is announced once', () => {
    page();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('off');
  });
});
