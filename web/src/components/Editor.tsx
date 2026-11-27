// The code editor: CodeMirror with C highlighting, line numbers, bracket matching and automatic
// indentation, no autocompletion, read-only during a run, and the diagnostic's marker
// (design/frontend-screens.md#editor).
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { setDiagnostics } from '@codemirror/lint';
import { Compartment, EditorState, type Text } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Position, Range } from 'engine';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { codePoint, markOf, pieces } from '../visible';

/**
 * Invisible characters drawn as marks, besides CodeMirror's own (C0 and C1 controls among them):
 * every format character (Unicode's Cf, the bidirectional controls included), so code cannot read
 * differently from what runs (design/frontend-screens.md#editor).
 */
const INVISIBLE = /\p{Cf}/u;

/** Each mark as the console draws it (design/frontend-screens.md#console). */
function renderMark(code: number): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'cm-specialChar';
  mark.textContent = markOf(code);
  mark.title = codePoint(code);
  return mark;
}

/**
 * The offset of a position, clamped to the document so a range of older code stays usable: a line
 * before the first is the start, one past the last is the end, so a range never turns backwards.
 */
export function offsetOf(doc: Text, position: Position): number {
  if (position.line < 1) return 0;
  if (position.line > doc.lines) return doc.length;
  const line = doc.line(position.line);
  return line.from + Math.min(Math.max(position.column - 1, 0), line.length);
}

/** A lint message with its special characters as marks, as the console shows it. */
function renderMessage(message: string): Node {
  const fragment = document.createDocumentFragment();
  for (const piece of pieces(message)) {
    if (typeof piece === 'string') {
      fragment.append(piece);
    } else {
      const mark = document.createElement('span');
      mark.className = 'special-char';
      mark.textContent = markOf(piece.code);
      fragment.append(mark);
    }
  }
  return fragment;
}

/** What the page asks of the editor besides its props. */
export interface EditorHandle {
  /** Selects a range, scrolls to it and focuses the editor. */
  reveal(range: Range): void;
}

/** A diagnostic's lint marker: its range and its message. */
export interface Marker {
  range: Range;
  message: string;
}

const highlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.modifier,
    ],
    color: 'var(--syntax-keyword)',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName))],
    color: 'var(--syntax-function)',
  },
  { tag: [tags.operator, tags.escape], color: 'var(--syntax-operator)' },
  { tag: [tags.typeName, tags.standard(tags.typeName)], color: 'var(--syntax-type)' },
  { tag: [tags.string, tags.character], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool], color: 'var(--syntax-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syntax-comment)' },
  { tag: [tags.processingInstruction, tags.macroName], color: 'var(--syntax-preprocessor)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)' },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'var(--line-number)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.75rem 0 1rem' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--line-number-active)' },
  '.cm-cursor': { borderLeftColor: 'var(--code-cursor)' },
  '.cm-specialChar': { color: 'var(--special)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--destructive)',
    textUnderlineOffset: '3px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
  },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--destructive)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--selection)' },
});

export function Editor({
  initial,
  label,
  onChange,
  readOnly,
  marker,
  ref,
}: {
  /** The code it starts with; later changes come from the user. */
  initial: string;
  label: string;
  onChange: (code: string) => void;
  readOnly: boolean;
  marker: Marker | undefined;
  ref?: Ref<EditorHandle>;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const readOnlySetting = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is created once; `initial` only seeds it, and the effects below set the rest.
  useEffect(() => {
    const created = new EditorView({
      parent: parent.current as HTMLDivElement,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars({ addSpecialChars: INVISIBLE, render: renderMark }),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          cpp(),
          theme,
          readOnlySetting.current.of(EditorState.readOnly.of(false)),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = undefined;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlySetting.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const current = view.current;
    if (current === undefined) return;
    const { doc } = current.state;
    const diagnostics =
      marker === undefined
        ? []
        : [
            {
              from: offsetOf(doc, marker.range.start),
              to: offsetOf(doc, marker.range.end),
              severity: 'error' as const,
              message: marker.message,
              renderMessage: () => renderMessage(marker.message),
            },
          ];
    current.dispatch(setDiagnostics(current.state, diagnostics));
  }, [marker]);

  useImperativeHandle(
    ref,
    () => ({
      reveal(range) {
        const current = view.current;
        if (current === undefined) return;
        const { doc } = current.state;
        const from = offsetOf(doc, range.start);
        current.dispatch({
          selection: { anchor: from, head: offsetOf(doc, range.end) },
          effects: EditorView.scrollIntoView(from, { y: 'center' }),
        });
        current.focus();
      },
    }),
    [],
  );

  return <div ref={parent} className="h-full min-h-0 overflow-hidden" />;
}
