# Debugger

> Part of the [playground-cc spec](README.md). Related: [engine](engine.md), [worker protocol](worker-protocol.md), [frontend screens](frontend-screens.md), [memory](memory.md), [errors](errors.md).

A gdb-style command console (0.7, 1.0): the user debugs by typing gdb's commands, with gdb's names and behavior, over the engine's paused state ([engine](engine.md#execution-model)). There are no buttons, gutter breakpoints or panels for it; the [memory view](memory-view.md) (0.8) is a separate window with its own buttons and session.

## Session

- **Debug** is a button next to Run. It starts a debug session: the program is loaded but not started, and the console shows the `(gdb)` prompt. A diagnostic before the run ends the session at once, as it ends a run ([errors](errors.md#format)).
- **One session at a time**, and no run during it: the Run/Stop button is disabled for the whole session. Everything is done with commands.
- **One console, as in a terminal**: program output and the debugger's answers share the console; answers are styled apart, like input echo, and the copy button copies only program output ([frontend screens](frontend-screens.md#console)).
- **The input field** is the `(gdb)` prompt while the program is paused or not running, and the program's `stdin` while it runs ([libc](libc.md#input)). End of input at the prompt is `quit`.
- **Ctrl+C in the input field pauses** a running program, as in gdb: it stops between two steps and the prompt returns. With text selected it copies, as usual; at the prompt it does nothing. `kill` ends the program and keeps the session; `quit` ends the session.
- **When the program ends** on its own, the console shows its exit status and leak report ([memory](memory.md#leak-report)); after `kill`, a line saying so, with no exit status or leak report. Either way the prompt returns, so it can be run again.
- **A diagnostic during the run pauses** at the place it happened, shows it, and its variables can still be inspected, as gdb does when a program receives a signal. Any command that would resume ends the program, and the prompt returns.
- **Breakpoints, watchpoints and displays** last for the whole session, across runs. A watchpoint on a local is deleted when its scope ends, as in gdb.
- The editor is read-only during a session, as during a run, and highlights the line where the program is paused. The run status shows "paused" ([frontend screens](frontend-screens.md#desktop)).
- **Debugging costs no steps**: only the program's own steps, and those before the run ([engine](engine.md#before-the-run)), count toward the step budget, and only the program's toward `clock` ([limits](limits.md)); evaluating expressions, displays and watchpoint checks are free, and time spent paused does not count.

## Commands

gdb's names and its abbreviations (any unique prefix, plus `b`, `c`, `n`, `s`, `p`, `bt`, `i`, `l`, `r`, `k`, `q`).

| Command | Does |
|---|---|
| `run`, `start` | Start the program; `start` stops at the first line of `main` |
| `continue` | Resume until a breakpoint, a watchpoint, a diagnostic or the end |
| `next [n]`, `step [n]` | Run until the source line changes, over calls (`next`) or into them (`step`); returning from a function also stops |
| `finish` | Run until the current function returns, and print its return value; an error in `main`'s frame |
| `kill`, `quit` | End the program; end the session |
| `break LOC` | A breakpoint at a line, `file:line` or function |
| `watch EXPR` | Stop when the value of a scalar lvalue changes, showing the old and new value; a non-scalar (array, struct or union) gives an error |
| `delete [n]`, `info breakpoints` | Delete one or all breakpoints and watchpoints; list them |
| `print[/f] EXPR`, `display[/f] EXPR`, `undisplay n` | Evaluate an expression; `display` prints it at every stop. `/f` is `x`, `d`, `u`, `o`, `t`, `c`, `a`, `f` or `s` |
| `set var LVALUE = EXPR` | Change a variable while paused |
| `x/NFU EXPR` | Examine memory at a pointer: count, format and unit (`b`, `h`, `w`, `g`), as in gdb |
| `ptype EXPR` | Show a type, expanding only its outer level, as gdb does ([errors](errors.md#format)); its members, enumerators and parameters count toward the printed elements limit, then `...` |
| `info locals`, `info args` | The current frame's locals and arguments |
| `backtrace`, `frame n`, `up`, `down` | The call stack, up to the frames listed limit then how many more ([limits](limits.md#run-limits)), and choosing the frame commands apply to |
| `list [LOC]` | Show source lines around a place, each cut at the text length limit with `…` ([limits](limits.md#run-limits)) |
| `help [command]` | List the commands, or explain one |

- **An empty line** repeats the last command only for `next`, `step`, `continue`, `finish`, `x`, `list`, `up` and `down`, as gdb does; after any other command it does nothing.
- **Lines**: `next` and `step` follow source lines; a line with several statements is one stop, and a macro's code belongs to the line that uses it (function-like macros from 0.9, 1.0).
- **Expressions** are C expressions over the selected frame: variables in scope, operators, casts, indexing, `.`, `->`, `&` and `*`, plus gdb's `@` (`arr[0]@5`) and value history (`$1`, `$`). The history keeps only what was printed, up to the printed elements limit, never a full copy of a large value: a value whose printing was cut there gives a debugger error when an expression uses it, while a complete one (a scalar, a pointer, or an aggregate within the limit) is used as printed. Calling functions is not supported, so evaluating never changes the program, except through `set var`.
- **Memory checks still hold**: an expression that would read outside a block, through a null or dangling pointer, gives a debugger error instead of a value ([memory](memory.md#detected-errors)). `x` takes a pointer expression, never an integer address, since integers do not become pointers ([memory](memory.md#pointers)), and stops with an error at the end of the block. Debugger errors never stop or change the program.
- **Unwritten values** print as `<unwritten>` instead of gdb's leftover bytes, from the per-byte state ([memory](memory.md#blocks)), in `print` and in `x` alike.
- **Values** print as gdb prints them: `$1 = 42`, `{x = 1, y = 2}`, `{1, 2, 3}`, `65 'A'`, `(int *) 0x7ffffffde01c`, `0x404010 "hola"`, using the engine's deterministic addresses ([memory](memory.md#pointers)). As in gdb, printing stops at the printed elements limit, then `...`, but counted in total for the whole command or stop (every value of `info locals`, every `display`), across nested arrays, structs and unions, with each character of a string (a `char *`'s text, `/s`, `x/s`) counting as one element; nothing past it is read. A run of equal elements prints as `<repeats N times>`, its elements still counting toward the limit, so a longer run is never read to count it. `x` shows at most that many units, then `...`. Names and types longer than the text length limit are cut with `…` ([limits](limits.md#run-limits)).
- An unknown command answers as gdb does: `Undefined command: "foo".  Try "help".`

## Where it lives

- **The engine** parses commands, evaluates expressions and runs to the next stop; its answers are data (a breakpoint hit, a value, a frame list, an error), never text ([architecture](architecture.md#components)).
- **The UI** formats each answer with the message catalogs. Command names and syntax stay gdb's in English in both languages; the messages, `help` included, follow gdb's text in `en` and are translated in `es`. Values and source text are never translated.

## Messages

Added to the [worker protocol](worker-protocol.md). A session is one run for its rules: one `runId` for the whole session, and `ended` only when the session ends (`quit`, a diagnostic before the run, a Worker failure).

| Direction | Type | Fields | Meaning |
|---|---|---|---|
| UI to Worker | `debug` | `runId`, `files` | Start a debug session, like `run` starts a run |
| UI to Worker | `command` | `runId`, `text` | One line typed at the `(gdb)` prompt |
| Worker to UI | `answers` | `runId`, `items` | The debugger's answers to a command or a stop, in order; the end of a program (its status and leaks, or that it was killed) is one of them |
| Worker to UI | `prompt` | `runId`, `location` | Waiting for a command; `location` is the paused line, or none when the program is not running |

- The Worker takes `command` only at the prompt, and `input` and `end_input` only while the program runs; `waiting_input` works as in a run.
- `stop` during a session (sent by Ctrl+C) pauses: the Worker answers with `prompt`, which counts as the answer the Stop timeout waits for ([worker protocol](worker-protocol.md#worker-to-ui)).
