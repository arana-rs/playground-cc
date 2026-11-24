# C engine

> Part of the [playground-cc spec](../spec.md). Related: [frontend](frontend.md), [deployment](deployment.md).

## Execution model

- The engine is written in TypeScript and runs in a Web Worker ([frontend](frontend.md)).
- **Resumable interpreter**: all execution state (call frames, values, the current position in the program) lives in the engine's own data structures, never in the JavaScript call stack. Execution advances in steps and can pause between any two steps and resume later from the same point.
- Every feature that needs to stop the program uses that same pause:
  - **Interactive `stdin`**: when a read needs input that has not arrived, the engine pauses and the Worker asks the main thread for it with a message; when the text arrives, execution resumes where it stopped.
  - **Stepping**: the debugger and the memory snapshots read the paused state.
  - **Stop**: execution ends between two steps.
  - **Execution budgets**: counted in steps.
- Threads (planned, [roadmap](roadmap.md#in-the-roadmap)) must fit this model: each thread is one more set of execution state, and the engine's scheduler decides which one takes the next step.
- No `SharedArrayBuffer` or `Atomics.wait`, so the site needs no cross-origin isolation headers (COOP/COEP) ([deployment](deployment.md)).
