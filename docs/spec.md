# playground-cc: specification

Browser-based C playground for learning and teaching C.

**How to read this spec.** This page holds the principles and a map. Each topic lives in its own file under [`spec/`](spec/), short enough to read on its own: read this page first, then only the fragments your task needs. Decisions live here; research notes and benchmarks do not.

---

## Principles

- **Learning and teaching**: playground-cc is for people learning C and for those teaching it. When a choice has to be made, seeing and understanding what the program does comes before speed or completeness.
- **Runs in the browser**: the site is static files and the engine runs in a Web Worker ([deployment](spec/deployment.md), [engine](spec/engine.md)). There is no backend.
- **Engine independent of the UI**: the engine imports no DOM, React or Worker APIs; the Worker and the UI sit on top of it.
- **Explicit diagnostics**: anything unsupported, and any undefined behavior the engine detects, stops the program with a clear diagnostic. Nothing is silently accepted or guessed.
- **Same output as GCC and Clang**: a supported program free of undefined behavior prints what it prints when built natively with GCC or Clang on LP64 Linux. Oracle tests check it.
- **Deterministic runs**: the same code and the same input always give the same output and the same steps. Nothing depends on the real clock or on unseeded randomness.
- **Code stays in the browser**: user code and data never leave the browser unless the user explicitly shares or exports them.
- **No telemetry**: no analytics, crash reports or update checks. The site makes no external calls of its own.
- **Works offline**: once loaded, the playground keeps working without a connection.
- **Compact UI**: a dense, editor-first interface, in the style of a developer tool.

## Non-goals

Nothing is built for these, and the architecture does not account for them.

- **Native performance**: it is an interpreter for understanding programs, not a fast runtime.
- **Full libc**: only a chosen subset of the standard library. Anything else gets an explicit diagnostic.
- **POSIX and operating system APIs**: no signals, processes, sockets or other operating system APIs. Threads are the exception: `pthread` support is planned ([roadmap](spec/roadmap.md#in-the-roadmap)).
- **Accounts and backend**: no sign-in, server storage or cloud features.

---

## Map

| Fragment | Read it for |
|---|---|
| [frontend](spec/frontend.md) | Frontend technology choices |
| [engine](spec/engine.md) | The C engine's execution model: resumable interpreter, interactive `stdin`, stepping, Stop and budgets |
| [deployment](spec/deployment.md) | Static hosting with static-web-server behind a TLS reverse proxy, route fallback |
| [roadmap](spec/roadmap.md) | Phases, each phase's exit tests and every feature's phase |

---

## Glossary
