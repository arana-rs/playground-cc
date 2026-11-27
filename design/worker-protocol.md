# Worker protocol

> Part of the [playground-cc spec](README.md). Related: [architecture](architecture.md), [engine](engine.md), [errors](errors.md), [libc](libc.md).

The messages between the UI on the main thread and the Worker loop ([architecture](architecture.md#components)).

## Rules

- **Plain objects** sent with `postMessage`, each with a `type` field. The message types live in `web/`, next to the Worker entry; diagnostics and the leak report are the engine's own types ([errors](errors.md#format), [memory](memory.md#leak-report)).
- **No version**: the UI and the Worker always come from the same build.
- **No handshake**: the UI posts `run` as soon as it has a Worker; `postMessage` queues it until the Worker has loaded.
- **One run at a time**: the UI never starts a run or a session before the previous one's `ended`: the Run button does nothing for the first second of a plain run and is then the Stop button ([frontend screens](frontend-screens.md#desktop)), and is unavailable during a debug or memory view session.
- **Run ids**: the UI numbers each run, and every message about a run carries its `runId`. Both sides ignore messages whose `runId` is not the active run's: the UI drops late output from a stopped run, and the Worker drops an `input`, `end_input` or `stop` that crossed the `ended` of its run. `run` starts with an empty input queue and no end of input.

## UI to Worker

| Type | Fields | Meaning |
|---|---|---|
| `run` | `runId`, `files` (each a `name` and its `text`) | Start a run. One file, named `main.c`, until 0.9 (1.0) |
| `input` | `runId`, `text` | One line the user sent, without its newline; the Worker adds `\n` ([libc](libc.md#input)). Lines sent before the program reads them wait in order |
| `end_input` | `runId` | The end-of-input action: once the lines already sent are read, reads return `EOF` |
| `stop` | `runId` | End the run between two steps |

## Worker to UI

| Type | Fields | Meaning |
|---|---|---|
| `output` | `runId`, `text` | Program output, once per slice and before the run pauses or ends ([architecture](architecture.md#components)). The Worker decodes the bytes as streaming UTF-8, so a character split across slices arrives whole; invalid bytes become U+FFFD, and bytes of a character left incomplete when the run ends are flushed as U+FFFD before `ended` |
| `waiting_input` | `runId`, `received` | The program is paused on a read and no line is waiting. `received` counts the `input` and `end_input` messages the Worker has taken in this run; the UI ignores the message when it has already sent more, since the Worker resumed with them |
| `ended` | `runId`, `reason`, then by reason: `status` (`exit`), `leaks` (`exit`, when there are any), `diagnostic` (`diagnostic`) | The last message of a run. `reason` is `exit` (the program ended on its own), `diagnostic` or `stopped`. Limits, such as the output limit, end the run as diagnostics ([engine](engine.md#execution-model)) |

- **Stop**: the Worker answers `stop` with `ended` and reason `stopped`. If it does not arrive within the timeout ([architecture](architecture.md#components)), the UI terminates the Worker and shows the run as stopped.
- **A Worker that fails to load or crashes** (an `error` event): the UI ends the active run, if any, as if it had received `ended` with `engine.internal` ([errors](errors.md)), and discards the Worker.
- **A new Worker** replaces a terminated or discarded one only on the next run, debug session or memory view session, so a Worker that cannot load (offline, a missing file) never restarts in a loop.
- The debugger (0.7, 1.0) and the memory view (0.8, 1.0) add their messages in [debugger](debugger.md#messages) and [memory view](memory-view.md#messages); each of their sessions counts as one run for these rules.
