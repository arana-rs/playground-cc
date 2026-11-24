# C engine

> Part of the [playground-cc spec](../spec.md). Related: [frontend](frontend.md), [deployment](deployment.md).

## Execution model

- The engine is written in TypeScript and runs in a Web Worker ([frontend](frontend.md)).
- **Resumable interpreter**: all execution state (call frames, values, the current position in the program) lives in the engine's own data structures, never in the JavaScript call stack. Execution advances in steps and can pause between any two steps and resume later from the same point.
- **A step** is one operation of the program: evaluating one operator, one statement's control transfer, one call or one return. A library function charges one step per byte or element it processes (`memcpy`, `strlen`, `printf`'s output, each comparison of `qsort`), and runs across slices like any other code, so a large call neither escapes the step budget nor delays Stop.
- Every feature that needs to stop the program uses that same pause:
  - **Interactive `stdin`**: when a read needs input that has not arrived, the engine pauses and the Worker asks the main thread for it with a message ([worker protocol](worker-protocol.md)); when the text arrives, execution resumes where it stopped.
  - **Stepping** (1.0): the [debugger](debugger.md) and the [memory view](memory-view.md) pause between steps and read the paused state.
  - **Stop**: execution ends between two steps.
  - **Execution budgets**: counted in steps. Using up the step budget ([limits](limits.md)) stops the run with `limit.steps`.
  - **Output limit**: the program's total output has a size in bytes ([limits](limits.md)). A write that would pass it stops the run with `limit.output`, so a program printing in a loop cannot flood the console before the step budget runs out. The engine checks it on each write, so the cut is the same on every run and in the oracle tests.
- Threads (planned, [roadmap](roadmap.md#in-the-roadmap)) must fit this model: each thread is one more set of execution state, and the engine's scheduler decides which one takes the next step.
- No `SharedArrayBuffer` or `Atomics.wait`, so the site needs no cross-origin isolation headers (COOP/COEP) ([deployment](deployment.md)).
