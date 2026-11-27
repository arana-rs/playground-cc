// @vitest-environment jsdom
import { diagnosticCount, forEachDiagnostic } from '@codemirror/lint';
import { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Diagnostic } from 'engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { offsetOf } from '../src/components/Editor';
import { FakeRunner } from './fake-runner';

const ch = (code: number) => String.fromCodePoint(code);
const at = (line: number, start: number, end = start) => ({
  file: 'main.c',
  start: { line, column: start },
  end: { line, column: end },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Renders the page and starts a run. */
function started() {
  const runner = new FakeRunner();
  const { container } = render(<App runner={runner} />);
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement);
  if (view === null) throw new Error('no editor');
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  const console = screen.getByRole('region', { name: 'Console' });
  return { runner, view, console, output: () => console.querySelector('pre') as HTMLElement };
}

describe('console output', () => {
  it('shows control and invisible characters as marks, and keeps tabs and newlines', () => {
    const { runner, output } = started();
    act(() => runner.last.output(`a\tb\r${ch(0x1b)}[0m${ch(0x7f)}${ch(0x202e)}z\n`));
    expect(output().textContent).toBe(`a\tb${ch(0x240d)}${ch(0x241b)}[0m${ch(0x2421)}U+202Ez\n`);
    expect(output().querySelectorAll('.special-char')).toHaveLength(4);
  });

  it('marks output that does not end in a newline once the run ends', () => {
    const { runner, output } = started();
    act(() => runner.last.output('no newline'));
    expect(output().querySelector('.eol-mark')).toBeNull();
    act(() => runner.last.ended({ reason: 'exit', status: 0 }));
    const mark = output().querySelector('.eol-mark');
    expect(mark?.getAttribute('aria-label')).toBe('No newline at the end of the output');
    expect(mark?.querySelector('svg')).not.toBeNull();
    // An icon, not text: the output reads, and copies, as the program wrote it.
    expect(output().textContent).toBe('no newline');
  });

  it('does not mark output that ends in a newline, nor empty output', () => {
    for (const text of ['line\n', '\n', '']) {
      const { runner, output } = started();
      act(() => runner.last.output(text));
      act(() => runner.last.ended({ reason: 'exit', status: 0 }));
      expect(output().querySelector('.eol-mark'), JSON.stringify(text)).toBeNull();
      cleanup();
    }
  });

  it('keeps every byte of a large output across chunks', () => {
    const { runner, output } = started();
    const line = `${'x'.repeat(99)}\n`;
    for (let i = 0; i < 300; i++) act(() => runner.last.output(line));
    expect(output().textContent).toBe(line.repeat(300));
    expect(output().children.length).toBeLessThan(300);
  });
});

describe('end of a run', () => {
  it('says the exit status, or that the run was stopped', () => {
    const { runner, console } = started();
    act(() => runner.last.output('hi\n'));
    act(() => runner.last.ended({ reason: 'exit', status: 3 }));
    expect(console.textContent).toContain('hi\nProgram exited with status 3.');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => runner.last.ended({ reason: 'stopped' }));
    expect(console.textContent).toBe('Program stopped.');
  });

  it('shows a diagnostic with its args, its range and its call stack', () => {
    const { runner, console } = started();
    const diagnostic: Diagnostic = {
      code: 'ub.format_mismatch',
      args: { conversion: '%d', type: 'char *' },
      range: at(2, 39, 40),
      stack: {
        frames: [
          { function: 'show', range: at(2, 39, 40) },
          { function: 'main', range: at(3, 25, 32) },
        ],
        total: 2,
      },
    };
    act(() => runner.last.ended({ reason: 'diagnostic', diagnostic }));
    const items = [...console.querySelectorAll('li')].map((li) => li.textContent);
    expect(console.querySelector('.end-line p')?.textContent).toBe(
      '‘%d’ does not take an argument of type ‘char *’. line 2, column 39',
    );
    expect(items).toEqual(['in show line 2, column 39', 'in main line 3, column 25']);
  });

  it('counts the frames past the listed ones, with plurals', () => {
    for (const [total, more] of [
      [2, '1 more frame'],
      [1201, '1,200 more frames'],
    ] as const) {
      const { runner, console } = started();
      const frame = { function: 'f', range: at(1, 1) };
      const diagnostic: Diagnostic = {
        code: 'limit.stack',
        args: { limit: 8388608 },
        range: at(1, 1),
        stack: { frames: [frame], total },
      };
      act(() => runner.last.ended({ reason: 'diagnostic', diagnostic }));
      expect(console.textContent).toContain('the stack of 8,388,608 bytes');
      expect([...console.querySelectorAll('li')].at(-1)?.textContent).toBe(more);
      cleanup();
    }
  });

  it('translates construct keys, and shows keywords and unknown codes as written', () => {
    const cases: [Diagnostic, string][] = [
      [{ code: 'unsupported.construct', args: { construct: 'cast' } }, 'Not supported: casts.'],
      [{ code: 'unsupported.construct', args: { construct: 'char' } }, 'Not supported: ‘char’.'],
      [{ code: 'ub.out_of_bounds' as Diagnostic['code'], args: {} }, 'Error ub.out_of_bounds.'],
      [
        { code: 'name.undeclared', args: { name: `a${ch(0x202e)}b` } },
        '‘aU+202Eb’ is not declared.',
      ],
    ];
    for (const [diagnostic, text] of cases) {
      const { runner, console } = started();
      act(() => runner.last.ended({ reason: 'diagnostic', diagnostic }));
      expect(console.textContent).toBe(text);
      cleanup();
    }
  });

  it('speaks the user language', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es']);
    const runner = new FakeRunner();
    render(<App runner={runner} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
    act(() =>
      runner.last.ended({
        reason: 'diagnostic',
        diagnostic: { code: 'limit.steps', args: { limit: 100000000 }, range: at(4, 2) },
      }),
    );
    expect(screen.getByRole('region', { name: 'Consola' }).textContent).toBe(
      'El programa agotó sus 100.000.000 pasos. línea 4, columna 2',
    );
  });
});

describe('links, markers and the editor', () => {
  const division: Diagnostic = {
    code: 'ub.division_by_zero',
    args: {},
    range: at(3, 10, 15),
    stack: { frames: [{ function: 'main', range: at(3, 10, 15) }], total: 1 },
  };

  it('moves the editor to a range when it is chosen', () => {
    const { runner, view } = started();
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'ab\ncd\nefghijklmnopqrstu\n' },
      });
    });
    act(() => runner.last.ended({ reason: 'diagnostic', diagnostic: division }));
    fireEvent.click(screen.getAllByRole('button', { name: 'line 3, column 10' })[1] as HTMLElement);
    const { from, to } = view.state.selection.main;
    expect([from, to]).toEqual([6 + 9, 6 + 14]);
  });

  it('marks the diagnostic in the editor until the code changes or the next run starts', () => {
    const { runner, view } = started();
    act(() => runner.last.ended({ reason: 'diagnostic', diagnostic: division }));
    expect(diagnosticCount(view.state)).toBe(1);
    act(() => {
      view.dispatch({ changes: { from: 0, insert: ' ' } });
    });
    expect(diagnosticCount(view.state)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => runner.last.ended({ reason: 'diagnostic', diagnostic: division }));
    expect(diagnosticCount(view.state)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(diagnosticCount(view.state)).toBe(0);
  });

  it('clamps ranges of code edited since, so a selection never turns backwards', () => {
    const doc = Text.of(['ab', 'cd', 'efg']);
    const pos = (line: number, column: number) => offsetOf(doc, { line, column });
    expect([pos(1, 1), pos(2, 2), pos(3, 4), pos(3, 99)]).toEqual([0, 4, 9, 9]);
    expect([pos(0, 5), pos(4, 1), pos(9, 9)]).toEqual([0, 9, 9]);
    expect(pos(3, 2)).toBeLessThanOrEqual(pos(5, 1));
  });

  it('moves to the end of the code for a range past its last line', () => {
    const { runner, view } = started();
    act(() => runner.last.ended({ reason: 'diagnostic', diagnostic: division }));
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'ab\ncdefghijklmn' },
      });
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'line 3, column 10' })[0] as HTMLElement);
    const { from, to } = view.state.selection.main;
    expect([from, to]).toEqual([15, 15]);
  });

  it('draws marks in the marker message too', () => {
    const { runner, view } = started();
    const diagnostic: Diagnostic = {
      code: 'directive.error',
      args: { message: `x${ch(0x202e)}y` },
      range: at(1, 1, 3),
    };
    act(() => runner.last.ended({ reason: 'diagnostic', diagnostic }));
    const rendered: Node[] = [];
    forEachDiagnostic(view.state, (d) => {
      const node = d.renderMessage?.(view);
      if (node !== undefined) rendered.push(node);
    });
    expect(rendered.map((node) => node.textContent)).toEqual(['#error xU+202Ey']);
  });

  it('does not mark a diagnostic without a range', () => {
    const { runner, view } = started();
    act(() =>
      runner.last.ended({
        reason: 'diagnostic',
        diagnostic: { code: 'name.missing_main', args: {} },
      }),
    );
    expect(diagnosticCount(view.state)).toBe(0);
  });

  it('makes the editor read-only during a run', () => {
    const { runner, view } = started();
    expect(view.state.readOnly).toBe(true);
    act(() => runner.last.ended({ reason: 'exit', status: 0 }));
    expect(view.state.readOnly).toBe(false);
  });
});

describe('scrolling', () => {
  it('follows new output until the user scrolls up, and again on the next run', () => {
    const { runner, console } = started();
    const scroller = console.querySelector('.overflow-auto') as HTMLElement;
    let height = 1000;
    Object.defineProperty(scroller, 'scrollHeight', { get: () => height, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    act(() => runner.last.output('a\n'));
    expect(scroller.scrollTop).toBe(1000);
    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);
    height = 2000;
    act(() => runner.last.output('b\n'));
    expect(scroller.scrollTop).toBe(200);
    act(() => runner.last.ended({ reason: 'exit', status: 0 }));
    expect(scroller.scrollTop).toBe(200);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    act(() => runner.last.output('c\n'));
    expect(scroller.scrollTop).toBe(2000);
  });
});

describe('copying', () => {
  it('copies exactly what the program wrote, without marks or end lines', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { runner } = started();
    expect(screen.getByRole('button', { name: 'Copy output' }).hasAttribute('disabled')).toBe(true);
    act(() => runner.last.output(`a${ch(0x0d)}b`));
    act(() => runner.last.output('c'));
    act(() => runner.last.ended({ reason: 'exit', status: 0 }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy output' })));
    expect(writeText).toHaveBeenCalledWith(`a${ch(0x0d)}bc`);
    expect(screen.getByRole('button', { name: 'Output copied' })).toBeDefined();
  });

  it('leaves the button as it was when the clipboard is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { runner } = started();
    act(() => runner.last.output('x'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy output' })));
    expect(writeText).toHaveBeenCalledWith('x');
    expect(screen.getByRole('button', { name: 'Copy output' })).toBeDefined();
  });
});
