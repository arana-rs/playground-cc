// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { HELLO_WORLD } from '../src/hello';
import type { RunCallbacks } from '../src/runner';
import type { RunControl } from '../src/useRun';

/** A Runner stand-in: the test plays the Worker's part through the callbacks it keeps. */
class FakeRunner implements RunControl {
  readonly runs: { files: { name: string; text: string }[]; callbacks: RunCallbacks }[] = [];
  stops = 0;

  run(files: { name: string; text: string }[], callbacks: RunCallbacks): void {
    this.runs.push({ files, callbacks });
  }

  stop(): void {
    this.stops++;
  }

  get last(): RunCallbacks {
    return this.runs.at(-1)?.callbacks as RunCallbacks;
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('starts ready, with the hello world program and a hint in the console', () => {
    render(<App runner={new FakeRunner()} />);
    expect(screen.getByRole('heading').textContent).toBe('playground-cc');
    expect(screen.getByRole('status').textContent).toBe('Ready');
    expect(screen.getByRole('region', { name: 'Console' }).textContent).toBe(
      'Press Run to run your program.',
    );
    expect(screen.getByRole('textbox', { name: 'Code' }).textContent).toContain('Hello, world!');
  });

  it('runs the code, shows the output, and the status it ended with', () => {
    const runner = new FakeRunner();
    render(<App runner={runner} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(runner.runs.map((r) => r.files)).toEqual([[{ name: 'main.c', text: HELLO_WORLD }]]);
    expect(screen.getByRole('status').textContent).toBe('Running');
    const console = screen.getByRole('region', { name: 'Console' });
    expect(console.textContent).toBe('');
    act(() => runner.last.output('Hello, '));
    act(() => runner.last.output('world!\n'));
    expect(console.textContent).toBe('Hello, world!\n');
    act(() => runner.last.ended({ reason: 'exit', status: 1234 }));
    expect(screen.getByRole('status').textContent).toBe('Exited with status 1,234');
  });

  it('turns Run into Stop during a run, and clears the console on the next run', () => {
    const runner = new FakeRunner();
    render(<App runner={runner} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => runner.last.output('loop'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(runner.stops).toBe(1);
    act(() => runner.last.ended({ reason: 'stopped' }));
    expect(screen.getByRole('status').textContent).toBe('Stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('region', { name: 'Console' }).textContent).toBe('');
    act(() =>
      runner.last.ended({
        reason: 'diagnostic',
        diagnostic: { code: 'ub.division_by_zero', args: {} },
      }),
    );
    expect(screen.getByRole('status').textContent).toBe('Stopped by an error');
  });

  it('runs the code as edited', () => {
    const runner = new FakeRunner();
    const { container } = render(<App runner={runner} />);
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement);
    act(() => {
      view?.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'int main(void) {}' },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(runner.runs[0]?.files[0]?.text).toBe('int main(void) {}');
  });

  it('works under StrictMode, with one editor whose changes run', () => {
    const runner = new FakeRunner();
    const { container } = render(
      <StrictMode>
        <App runner={runner} />
      </StrictMode>,
    );
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(1);
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement);
    act(() => {
      view?.dispatch({ changes: { from: 0, insert: '// edited\n' } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(runner.runs[0]?.files[0]?.text).toBe(`// edited\n${HELLO_WORLD}`);
  });

  it('draws invisible characters as marks in the editor', () => {
    const { container } = render(<App runner={new FakeRunner()} />);
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement);
    // A bidirectional override, a C1 control, a zero-width joiner and a word joiner.
    act(() => {
      view?.dispatch({ changes: { from: 0, insert: 'a\u202eb\u0085c\u200dd\u2060e' } });
    });
    expect(container.querySelectorAll('.cm-specialChar')).toHaveLength(4);
  });

  it('speaks the browser language by its base tag, with English otherwise', () => {
    const languages = vi.spyOn(navigator, 'languages', 'get');
    languages.mockReturnValue(['es-MX']);
    render(<App runner={new FakeRunner()} />);
    expect(screen.getByRole('status').textContent).toBe('Listo');
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeDefined();
    cleanup();
    languages.mockReturnValue(['fr-FR', 'de']);
    render(<App runner={new FakeRunner()} />);
    expect(screen.getByRole('status').textContent).toBe('Ready');
  });

  it('formats the exit status with the locale', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es']);
    const runner = new FakeRunner();
    render(<App runner={runner} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
    act(() => runner.last.ended({ reason: 'exit', status: 12345 }));
    expect(screen.getByRole('status').textContent).toBe('Terminó con estado 12.345');
  });
});
