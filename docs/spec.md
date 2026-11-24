# playground-cc: specification

Browser-based C playground for learning and teaching C.

License: **AGPL-3.0** (see [LICENSE](../LICENSE), [licensing](spec/licensing.md)).

**How to read this spec.** This page holds the principles and a map. Each topic lives in its own file under [`spec/`](spec/), short enough to read on its own: read this page first, then only the fragments your task needs. Decisions live here; research notes and benchmarks do not.

---

## Principles

- **Learning and teaching**: playground-cc is for people learning C and for those teaching it. When a choice has to be made, seeing and understanding what the program does comes before speed or completeness.
- **Runs in the browser**: the site is static files and the engine runs in a Web Worker ([deployment](spec/deployment.md), [engine](spec/engine.md)). There is no backend.
- **Engine independent of the UI**: the engine imports no DOM, React or Worker APIs; the Worker and the UI sit on top of it ([architecture](spec/architecture.md)).
- **Explicit diagnostics**: anything unsupported (`unsupported.construct`), and any undefined behavior the engine detects, stops the program with a clear diagnostic ([errors](spec/errors.md)). Nothing is silently accepted or guessed.
- **Same output as GCC and Clang**: a supported program free of undefined behavior, whose output does not depend on unspecified behavior, prints what it prints when built natively with GCC or Clang on LP64 Linux. Oracle tests check it.
- **Deterministic runs**: the same code and the same input always give the same output and the same steps. Nothing depends on the real clock or on unseeded randomness.
- **Code stays in the browser**: user code and data never leave the browser unless the user explicitly shares or exports them.
- **No telemetry**: no analytics, crash reports or update checks. The site makes no external calls of its own.
- **Works offline** (1.0): once loaded, the playground keeps working without a connection ([offline](spec/offline.md)).
- **Measured limits**: every run limit is counted in steps, bytes or counts, fixed by the release and measured on the reference hardware, an Intel N100-class laptop with Chrome ([limits](spec/limits.md)). The spec gives the measured value or says "set by measuring", never a value copied from elsewhere (only a cap on what is listed, like the leak report's, is chosen); a native GCC limit is only an upper bound.
- **Compact UI**: a dense, editor-first interface, in the style of a developer tool.

## Non-goals

Nothing is built for these, and the architecture does not account for them.

- **Native performance**: it is an interpreter for understanding programs, not a fast runtime.
- **Full libc**: only a chosen subset of the standard library. Anything else gets an explicit diagnostic (`unsupported.function`, [libc](spec/libc.md)).
- **POSIX and operating system APIs**: no signals, processes, sockets or other operating system APIs. Threads are the exception: `pthread` support is planned ([roadmap](spec/roadmap.md#in-the-roadmap)).
- **Accounts and backend**: no sign-in, server storage or cloud features.

---

## Map

| Fragment | Read it for |
|---|---|
| [architecture](spec/architecture.md) | Components (engine, Worker loop, UI, oracle tests), what each one owns and never does, slices, the Worker's lifecycle, repository layout |
| [frontend](spec/frontend.md) | Frontend technologies (CodeMirror 6, Tailwind + shadcn/ui, Paraglide), one page with no router, diagnostics in the console and editor, preferences, saving the code, i18n, shortcuts, accessibility, browser support |
| [frontend-screens](spec/frontend-screens.md) | The page layout: top bar and run status, editor and console side by side (tabs on phones), console output, echo and run endings, the input field, where the 1.0 features go |
| [debugger](spec/debugger.md) | The gdb-style command console (1.0): session, pausing with Ctrl+C and diagnostics while debugging, commands, expressions, value printing, where it lives, its messages |
| [engine](spec/engine.md) | The C engine's execution model: resumable interpreter, interactive `stdin`, stepping, Stop, the step budget and the output limit |
| [deployment](spec/deployment.md) | Static hosting with static-web-server behind a TLS reverse proxy, no route fallback |
| [language](spec/language.md) | The C accepted: C17 on x86-64 Linux, type sizes and implementation-defined behavior, supported constructs by phase, unsupported constructs and their keys, detected undefined behavior |
| [memory](spec/memory.md) | Blocks, per-byte initialization, pointers as block and offset, deterministic addresses, stack and heap sizes, detected memory errors, the leak report |
| [memory-view](spec/memory-view.md) | The memory view window (1.0): stepping forward and back by replay, play speed, I/O switch, detail level, boxes with address, value and name, sections, heap blocks without a type, pointer highlighting, its messages |
| [libc](spec/libc.md) | The standard library subset by phase, headers and functions outside it, `printf` and `scanf` behavior and format checks, interactive input, `fgets` and end of input, overlapping copies, `calloc` and `realloc`, math precision, deterministic `rand`, `time` and `clock`, `assert` |
| [worker-protocol](spec/worker-protocol.md) | Messages between the UI and the Worker (`run`, `input`, `end_input`, `stop`; `output`, `waiting_input`, `ended`), run ids on both sides, Stop and crash handling |
| [testing](spec/testing.md) | Unit, oracle, engine and minimal end-to-end tests, and what is reviewed by hand; how oracle cases get their expected results from GCC and Clang; cases by phase; robustness; CI |
| [sharing](spec/sharing.md) | Share links in the URL fragment (format, length, opening, bounds), export and import of files and `.zip` without a library, file-name rule (1.0) |
| [offline](spec/offline.md) | The service worker, cache first, updates across tabs, caching headers (1.0) |
| [security](spec/security.md) | Hostile code as the threat: no generated JavaScript, text never as HTML, shared programs never run on their own, the run's limits, response headers and CSP, dependencies |
| [limits](spec/limits.md) | Run limits (steps, output, stack, heap, source size, include depth, share link, memory view block and snapshot, leak report) and Worker tuning (slice, Stop timeout): unit, value, measuring criterion, reference hardware |
| [errors](spec/errors.md) | The diagnostic format (code, args, range, stack), before and during the run, translation, every diagnostic code, and the endings without a code |
| [roadmap](spec/roadmap.md) | Phases (alpha 0.1 to 0.6 with the MVP, beta 0.7 to 1.0, in the roadmap, not on the roadmap), each phase's exit tests and every feature's phase |
| [licensing](spec/licensing.md) | What the AGPL-3.0 covers (not the programs users write or their output), allowed dependency licenses and the build's check, copied and ported code, third-party notices, the Source code and Licenses links |

---

## Glossary

Terms with a meaning of their own in this spec, in alphabetical order.

- **Block**: one object in the engine's memory (a variable, a heap allocation, a string literal) with its own bytes, size and lifetime. A pointer is a block and an offset; bounds are checked per block ([memory](spec/memory.md#blocks)).
- **Diagnostic**: an error reported as data: a code such as `ub.out_of_bounds`, its arguments and, when a source location applies, a range and (during the run) a call stack. The UI translates it; the engine never produces text ([errors](spec/errors.md#format)).
- **Engine**: the `engine/` package, a library that turns C source into a run. It knows nothing of the DOM, React or Workers ([architecture](spec/architecture.md#components)).
- **Engine tests**: C programs run against the engine only, with their expected end as JSON (the output, then the diagnostic or the exit status and leak report), for what native builds cannot check ([testing](spec/testing.md#engine-tests)).
- **Exit tests**: the tests that close a phase; a phase is done when they and every earlier phase's pass ([roadmap](spec/roadmap.md)).
- **GCC and Clang guarantee**: a supported program free of undefined behavior, whose output does not depend on unspecified behavior, prints what it prints natively. Anything "outside the guarantee" (evaluation order, `clock`, the last bit of `sin`) is deterministic but may differ from a native build ([principles](#principles)).
- **Leak report**: the unfreed heap blocks listed when a program ends on its own; not a diagnostic and does not change the exit status ([memory](spec/memory.md#leak-report)).
- **MVP**: release 0.6, the first usable one. Behavior without a phase marker in the fragments is MVP scope ([roadmap](spec/roadmap.md)).
- **Oracle tests**: C programs run through the engine and through native GCC and Clang, whose output and exit status must match ([testing](spec/testing.md#oracle-tests)).
- **Pause**: the engine stopped between two steps with its whole state kept, to wait for input, at a debugger stop or at a memory view step ([engine](spec/engine.md#execution-model)).
- **Phase markers**: "(0.8, 1.0)" means built in 0.8, part of 1.0; "(1.0)" alone means beta scope (0.7 to 1.0, after the MVP); "(planned)" means after 1.0, in the roadmap ([roadmap](spec/roadmap.md)).
- **Provisional value**: a limit's or a Worker tuning value's number chosen when its feature is built, used by exit tests until it is measured on the reference hardware by 1.0 ([limits](spec/limits.md#rules)).
- **Reference hardware**: an Intel N100-class laptop with 8 GB of memory and current Chrome, on which the limits and the Worker tuning values are measured ([limits](spec/limits.md#rules)).
- **Replay**: running the program again from the start with the input already given, to reach a pause; how the memory view steps back and opens at a diagnostic ([memory view](spec/memory-view.md#stepping)).
- **Run**: one execution of the program, from Run until it ends. A debug session and a memory view session each count as one run for the [worker protocol](spec/worker-protocol.md#rules).
- **Slice**: the steps the Worker loop runs before it yields to handle messages; output is sent once per slice ([architecture](spec/architecture.md#components)).
- **Snapshot**: the memory view's data for one pause: sections, frames, blocks and boxes, built by the engine at no cost in steps ([memory view](spec/memory-view.md#where-it-lives)).
- **Step**: one operation of the program (an operator, a control transfer, a call or a return), or one byte or element processed by a library function. The step budget (`limit.steps`), slices and `clock` count steps ([engine](spec/engine.md#execution-model)).
- **Undefined behavior (UB)**: what C17 leaves undefined. Each case the engine detects stops the program with a `ub.*` diagnostic ([language](spec/language.md#undefined-behavior), [memory](spec/memory.md#detected-errors)).
- **Unsupported**: a construct, header, library function or format conversion the engine does not accept, yet or ever. It gets an `unsupported.*` diagnostic before the run (during the run for `printf` and `scanf` conversions) instead of a guess ([language](spec/language.md#not-supported), [libc](spec/libc.md#headers-and-functions)).
- **Unwritten**: a byte that nothing has stored to yet. Reading a value with one stops with `ub.uninitialized_read`, except when bytes are only copied; the debugger shows it as `<unwritten>` and the memory view as `?` ([memory](spec/memory.md#blocks)).
- **Worker loop**: the code in the Web Worker that drives the engine in slices and exchanges messages with the UI ([architecture](spec/architecture.md#components), [worker protocol](spec/worker-protocol.md)).
