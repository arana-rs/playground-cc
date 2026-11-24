# Frontend screens

> Part of the [playground-cc spec](../spec.md). Related: [frontend](frontend.md), [worker protocol](worker-protocol.md), [errors](errors.md), [memory](memory.md#leak-report), [libc](libc.md#input), [licensing](licensing.md).

The layout of the one page ([frontend](frontend.md#one-page)): top bar, editor, console and input, on desktop and on phones, and where the 1.0 features go.

## Desktop

- **Top bar**: the name, the Run button (Stop while a run is active; disabled during a debug session, [worker protocol](worker-protocol.md#rules)), the run status, and one settings menu with the language (`es`, `en`), the theme (system, light, dark), and the Source code and Licenses links ([licensing](licensing.md#notices-and-source-agpl-sections-6-and-13)).
- **Run status**: ready (before the first run), running, waiting for input, exited with its status, stopped, or stopped by a diagnostic; during a debug session also paused ([debugger](debugger.md#session)).
- **Below the bar, side by side**: the editor on the left and the console on the right, with a divider that resizes them by dragging or, focused, with the arrow keys. The editor starts at 60% of the width.

## Phones

- Below 768 px wide, the editor and the console become two tabs, **Code** and **Console**, under the top bar, and the run status shows on the Console tab instead of the bar.
- Run switches to the Console tab. Choosing a diagnostic's range switches to the Code tab at that range.
- When the program waits for input while the Code tab is shown, the Console tab gets a mark; the input field is focused only once the console is visible.

## Editor

- C highlighting, line numbers, bracket matching and automatic indentation. No autocompletion: learners type their code.
- **Read-only during a run**, so every range a run reports (diagnostics, stack frames, leak report) points at the code that ran.
- Diagnostic markers ([frontend](frontend.md#diagnostics)) are cleared when the code changes or the next run starts.

## Console

- **Before the first run**: a hint saying how to run (the Run button, Ctrl+Enter).
- **Cleared** when a run starts.
- **Output** in a monospace font, wrapping long lines. There is no terminal emulation: `\n` breaks the line and `\t` advances to the next multiple of 8 columns; every other control character shows as its visible symbol (byte `0x00`–`0x1F` as U+2400 plus the byte, `0x7F` as `␡`), so `\r`, `\b` and escape sequences are never hidden effects.
- **Input echo**: each line the user sends is echoed in the console when it is sent, in a distinct style, as a terminal echoes typed-ahead input.
- **End of a run**, after the output:
  - exited: a line with the exit status, then the [leak report](memory.md#leak-report) when there are leaks;
  - stopped: a line saying so;
  - diagnostic: its message, its range and, during the run, its call stack and from 0.8 (1.0) a "View memory" link ([memory view](memory-view.md#opening-and-closing)).
- **Links**: every range in the console (a diagnostic's, each stack frame's, each leaked block's allocation) moves the editor to that place ([errors](errors.md#format)).
- **Copying**: the output can be selected as text, and a copy button copies exactly what the program wrote, without echo or end lines.
- **Scrolling** follows new output, unless the user has scrolled up.

## Input field

- A one-line field at the bottom of the console, with an end-of-input button ([libc](libc.md#input)). Enter sends the line.
- Enabled while a run is active, so lines can be typed ahead; disabled otherwise.
- When the program waits for input ([worker protocol](worker-protocol.md#worker-to-ui)), the field is focused (if the console is visible), highlighted together with the run status, and the live region announces it ([frontend](frontend.md#accessibility)).

## 1.0 features

Where the beta features go; each one's own fragment holds its behavior.
- **Debugger** (0.7): a Debug button next to Run; the console becomes the gdb console, with the `(gdb)` prompt in the input field, and the editor highlights the paused line ([debugger](debugger.md#session)).
- **Memory view** (0.8): a Memory button next to Run opens a window over the page with its own stepping, and a diagnostic during a run gets a "View memory" link in the console ([memory view](memory-view.md#opening-and-closing)).
- **Files** (0.9): tabs above the editor.
- **Sharing, export and import** (0.11): a menu in the top bar ([sharing](sharing.md)).
