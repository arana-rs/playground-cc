// The code editor: CodeMirror with C highlighting, line numbers, bracket matching and automatic
// indentation, and no autocompletion (design/frontend-screens.md#editor).
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
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
import { useEffect, useRef } from 'react';

/**
 * Invisible characters drawn as marks, besides CodeMirror's own (C0 and C1 controls among them):
 * every format character (Unicode's Cf, the bidirectional controls included), so code cannot read
 * differently from what runs (design/frontend-screens.md#editor).
 */
const INVISIBLE = /\p{Cf}/u;

const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword],
    color: 'var(--syntax-keyword)',
  },
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
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--accent) 60%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'color-mix(in oklch, var(--ring) 40%, transparent)' },
});

export function Editor({
  initial,
  label,
  onChange,
}: {
  /** The code it starts with; later changes come from the user. */
  initial: string;
  label: string;
  onChange: (code: string) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is created once; `initial` only seeds it.
  useEffect(() => {
    const view = new EditorView({
      parent: parent.current as HTMLDivElement,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars({ addSpecialChars: INVISIBLE }),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          cpp(),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, []);

  return <div ref={parent} className="h-full min-h-0 overflow-hidden" />;
}
