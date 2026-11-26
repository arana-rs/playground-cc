# Memory view

> Part of the [playground-cc spec](README.md). Related: [memory](memory.md), [frontend screens](frontend-screens.md), [worker protocol](worker-protocol.md), [debugger](debugger.md), [limits](limits.md).

The memory view (0.8, 1.0) is a window over the page that steps through the program line by line, forward and back, and draws its memory the way it is drawn in class: every value is a box, with its address above it, its value inside and its name below, and a pointer's box holds the address it points to. It is separate from the [debugger](debugger.md): it has its own buttons and its own session, and never runs at the same time as a run or a debug session.

## Opening and closing

- **The Memory button** in the top bar ([frontend screens](frontend-screens.md#10-features)) opens the window with the editor's code, paused before the first line of `main`. It is disabled during a run or a debug session. A diagnostic before the run does not open the window; it shows in the console as after Run ([errors](errors.md#format)).
- **From a diagnostic**: a diagnostic during a run gets a "View memory" link in the console. It opens the window paused where the diagnostic happened, by running the files that ran again with the input lines and the end of input the run received ([determinism](README.md#principles)), with I/O on if the run read any. Step back works from there.
- **Closing** (the close button or Escape) ends the session and returns to the page as it was. The page's console is not touched.
- The window is a modal dialog covering most of the page, and the whole screen on phones. The editor behind it cannot change while it is open.

## The window

- **Toolbar**: Play (Pause while playing), Step back, Step forward, the play speed, the I/O switch, the detail level, Stop and Close.
- **Code**: the program's files, read-only, as tabs from 0.9, with the line about to run highlighted. A status shows paused, playing, running (a long step), waiting for input, exited with its status, stopped, or stopped by a diagnostic, and the location of the statement about to run (`main.c:2:10`).
- **Below the code**, collapsible sections: **Static data**, **Stack** and **Heap** ([drawing](#drawing)), and **Console** when I/O is on. Static data starts collapsed. A divider resizes the code and the sections, by dragging or with the arrow keys.
- **Speed, I/O and detail level** are preferences, stored like the others ([frontend](frontend.md#preferences)).

## Stepping

- **Step forward** runs until the source line changes, or a function of the program is entered or returns, like gdb's `step` ([debugger](debugger.md#commands)). Library functions are stepped over.
- **Step back** returns to the previous pause, with the memory, the output and the input exactly as they were there. The engine runs the program again from the start, with the input lines already sent, up to that pause: runs are deterministic, so the replay reaches the same state.
- **Play** steps forward once every interval of the play speed (0.25, 0.5, 1 or 2 seconds; 0.5 by default). It pauses at a diagnostic, at the end of the program, when the program waits for input, or with Pause. Pressing a step button while playing pauses first.
- **Stop** ends the program, also while it waits for input or in the middle of a long step (an infinite loop on one line). The drawing stays at the last pause, Step forward and Play are disabled, and Step back works when there is an earlier pause.
- **Limits**: the session's run and each replay start from step 0 with the same run limits as a run, the steps before the run included ([limits](limits.md), [engine](engine.md#before-the-run)), so a replay reaches `limit.steps` at the same point.
- **A diagnostic** pauses where it happened, shows it under the toolbar and marks the block it is about. Step forward and Play are disabled; Step back works.
- **When the program ends**, the status shows its exit status, and the drawing shows what is left: static data and the heap blocks not freed (the leaks, [memory](memory.md#leak-report)).

## I/O

- **Off** (the default): `stdin` is empty, so every read returns `EOF` at once. Output still counts toward the output limit but is neither sent nor shown, and there is no Console section.
- **On**: the Console section shows the program's output up to the current pause, without input echo, and, when the program reads with no line waiting, the input field and the end-of-input action, as on the page ([libc](libc.md#input)), with control, C1 and bidirectional characters shown as marks as in the page's console ([frontend screens](frontend-screens.md#console)). Play pauses while it waits. Lines sent are kept: stepping back and forward again reuses them instead of asking.
- Switching I/O restarts the session from the beginning, since it changes what the program reads.

## What it shows

The program's live state, and what it still points to:
- every frame of the call stack, with its parameters and the locals in scope, and every global and `static` variable;
- every live heap block, reachable or not, so a leak shows too;
- the string literals, freed heap blocks and out-of-scope locals that a pointer in a shown box still points to. The last two are dead ([memory](memory.md#blocks)) and show only as a dimmed box with their caption, since their bytes are gone.

## Drawing

- **One box per scalar** (an integer, a character, a floating-point value, a pointer or an enum): its address above, its value inside, its label below. Every box has the same size whatever its type's size; the addresses show the sizes.
- **Detail level**: Minimal (the default) draws the boxes as above. Detailed also writes each box's type (with its `typedef` names, [errors](errors.md#format)) and size under its label, and draws the padding between struct members and after them as `?` boxes with their size.
- **Arrays and structs** become a row of boxes, one per scalar element or member, labeled with their path: `a[0]`, `a[1]`, `s.x`, `s.pts[1].y`. A union draws each member's boxes, all starting at the union's address.
- **Values**: integers in decimal, `_Bool` as `true` or `false`, floating-point values as the debugger prints them, an enum by its name, a `char` as a C character literal (`'A'`, `'\0'`, `'\n'`, `'\xc3'` for bytes outside printable ASCII). A pointer shows its address, or `NULL`; a function pointer (0.10) shows the function's name. A scalar with any unwritten byte shows `?` ([memory](memory.md#blocks)), and a pointer with no block shows its address, marked invalid.
- **Stack**: one row per frame, innermost first as `backtrace` lists them, captioned with the function and its current location. In each frame, boxes follow their addresses, which follow declaration order ([memory](memory.md#pointers)). A dead local shows in a dimmed row at the end of the section, captioned with its function.
- **Static data**: globals in address order, labeled with their names; a function's `static` variable as `f::count`, as gdb names it, and from 0.9 a file-scope `static` as `file.c::name`. A string literal is a row of character boxes captioned "string literal" and its location.
- **Heap**: blocks in address order, each captioned with the call that allocated it (`malloc`, `calloc` or `realloc`), its size and its location. A block has no type, so its boxes follow what was stored in it ([memory](memory.md#blocks)): each scalar whose bytes are all there, in order, is a box of the type it was stored as, labeled with its offset (`+0`, `+8`); a run of unwritten bytes is one `?` box, and a run of bytes `calloc` zeroed and nothing has written since is one `0` box, each labeled with its offset and size; any other bytes are one box per byte, in hex. A `malloc(0)` block shows only its caption.
- **Locations** are the line, or `file:line` from 0.9.
- **An empty section** says so.
- **No arrows**: hovering, focusing or tapping a pointer's box highlights the box that holds the address it points to, in any section, as matching its address by eye would; a dead block's dimmed box, or a collapsed section's header when the target is inside it. A pointer one past the end of its block, `NULL`, an invalid pointer or a function pointer highlights nothing.
- **Details on hover or focus**: a box's type, its size in bytes and its full label, up to the text length limit.
- **Changes**: a box whose value changed since the previous pause is marked.
- **Limits** ([limits](limits.md#run-limits)): building a snapshot never goes past these caps. Past the boxes per block, the rest of a block is one `…` box, without counting what it holds; past the boxes per snapshot, the rest of each section is one line: "N more frames" in the Stack, "N more blocks" in the others. Each frame and each block counts as one box besides its own boxes, so frames without locals and `malloc(0)` blocks count too. The snapshot fills the Stack first (innermost frame first), then the Heap, then Static data. Labels, types and captions longer than the text length limit are cut with `…`.

## Accessibility

- The window traps the focus while open, and Escape closes it. Every button is reachable from the keyboard.
- The boxes are one grid with a single tab stop, moved through with the arrow keys. Each box reads as its label, address and value, plus its state when it has one (unwritten, invalid, dead, changed, the diagnostic's block) and, for a pointer, the label of the box it points to. A `…` box reads as the rest of its block, not shown.
- The live region announces the status and, when stepping by hand, the new line; not each line while playing.
- On phones the window fills the screen and the rows wrap.

## Where it lives

- **The engine** runs the session and builds a snapshot of memory at each pause, as data: the sections; the frames; each block's id, kind, whether it is alive, the call that allocated it, its size and its location; each box's address, label path, type, size, and value or unwritten state; a pointer's target (block id and offset, `NULL`, invalid, or a function); the diagnostic's block id. Building it costs no steps.
- **The Worker** keeps the session's input lines, whether end of input was sent, and the number of the current pause, never a list of pauses: Step back runs the program again from the start, counting pauses, up to the one before; opening at a diagnostic counts the pauses on the way.
- **The UI** draws the snapshot. Captions and notices come from the message catalogs; values are never translated. It finds the changed boxes by comparing with the previous pause's snapshot by block id and label path, runs the Play timer, and keeps the session's output, showing as much of it as the current pause says.

## Messages

Added to the [worker protocol](worker-protocol.md). A session is one run for its rules: one `runId`, and `ended` only when the session ends (Close, a diagnostic before the run, a Worker failure). `input` and `end_input` work as in a run while the program waits.

| Direction | Type | Fields | Meaning |
|---|---|---|---|
| UI to Worker | `view` | `runId`, `files`, `io`, `input`, `endInput`, `toDiagnostic` | Start a session paused before `main`'s first line or, with `toDiagnostic`, at the first diagnostic (from a "View memory" link). `input` and `endInput` are the input to replay, otherwise empty and false |
| UI to Worker | `step` | `runId`, `direction` | `forward` or `back` |
| UI to Worker | `kill` | `runId` | Stop: end the program and keep the session |
| UI to Worker | `stop` | `runId` | Close: end the session |
| Worker to UI | `paused` | `runId`, `location`, `memory`, `outputLength`, `state` | A pause: the statement about to run, the snapshot, how much of the session's output exists at this pause (in UTF-16 code units of the decoded text), and the program's state (`running`, or `exit` with its status, `diagnostic` with it, or `stopped`) |

- The Worker sends each piece of output once per session, as `output`: replays, and steps up to output already sent, send nothing new.
- The Worker takes `step` only while paused, not during a step or while the program waits for input.
- `kill` and `stop` are answered within the Stop timeout, by `paused` and `ended` ([worker protocol](worker-protocol.md#worker-to-ui)). If either times out, the UI terminates the Worker and the session ends, since its replay state is gone.
