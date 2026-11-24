# Limits

> Part of the [playground-cc spec](../spec.md). Related: [engine](engine.md), [memory](memory.md), [memory view](memory-view.md), [architecture](architecture.md), [worker protocol](worker-protocol.md).

Every limit of a run, the Worker's tuning values, how each value is chosen, and where its rule lives.

## Rules

- **Fixed by the release**: there is no setting for any value on this page. Changing one is a change to this page and a new release.
- **Run limits are in steps, bytes or counts, never in time**, so the same program stops at the same point on every machine and in the oracle tests ([principles](../spec.md#principles)). A faster machine only gets there sooner; a slower one than the reference takes longer than the criterion's time.
- **Worker tuning values** never change what a program prints, so they may be in time.
- **Reference hardware**: an Intel N100-class laptop with 8 GB of memory, running current Chrome.
- **Measured on the oracle test corpus**: a criterion in time ("the steps the reference runs in 10 seconds") uses the average rate over the whole corpus on the reference, not one program.
- **Provisional, then measured**: each value gets a provisional number when its feature is built, written here and marked provisional, so exit tests have a concrete limit. Each is measured by 1.0 ([roadmap](roadmap.md#beta-up-to-10)).
- **Display caps**: a value that only bounds what is listed, not what a run may do (the leak report's entries), is chosen, not measured; the table says so.
- **Native caps**: where a native GCC build has a limit of its own (its stack, its include depth), that value is an upper bound: going further than a native program can has no use.

## Run limits

| Limit | Unit | Value | Criterion | Rule |
|---|---|---|---|---|
| Step budget | steps | Set by measuring | The steps the reference runs in 10 seconds | `limit.steps`, [engine](engine.md#execution-model) |
| Output limit | bytes | Set by measuring | The largest output the console keeps responsive on the reference (scrolling, selecting, copying) | `limit.output`, [engine](engine.md#execution-model) |
| Stack size | bytes | Set by measuring | The deepest stack the reference holds with room to spare, capped at 8 MiB, a native x86-64 Linux process's stack | `limit.stack`, [memory](memory.md#the-stack-and-the-heap) |
| Heap size | live bytes, plus a fixed overhead per block | Set by measuring | Well below what one tab holds on the reference, leaving room for the stack, the per-byte state, the memory view and the UI | `malloc` returns `NULL`, [memory](memory.md#the-stack-and-the-heap) |
| Source size | bytes, all files together | Set by measuring | The largest source the steps before the run handle in about one second on the reference | `limit.source`, [errors](errors.md) |
| Include depth (0.9, 1.0) | nested `#include`s | Set by measuring | The deepest nesting the reference handles, capped at GCC's 200 | `limit.include_depth`, [language](language.md#supported-by-phase) |
| Share link (0.11, 1.0) | characters of the URL | Set by measuring | The longest link that current browsers and common chat and mail apps keep intact | [sharing](sharing.md#share-link) |
| Memory view block (0.8, 1.0) | boxes per block | Set by measuring | Enough for the arrays of the oracle test corpus, well below the snapshot limit | [memory view](memory-view.md#drawing) |
| Memory view snapshot (0.8, 1.0) | boxes per snapshot | Set by measuring | The most boxes the engine builds and the window redraws at every step, and at the fastest play speed, without a visible delay on the reference | [memory view](memory-view.md#drawing) |
| Leak report | entries | 100 (chosen, a display cap) | The first unfreed blocks by allocation order; the totals always count them all | [memory](memory.md#leak-report) |

## Worker tuning

| Value | Unit | Value | Criterion | Rule |
|---|---|---|---|---|
| Slice size | steps | Set by measuring | The steps the reference runs in about 10 ms, so Stop and input are answered at once and the message overhead stays small | [architecture](architecture.md#components) |
| Stop timeout | milliseconds | Set by measuring | Well above the slowest slice on the reference, so only a stuck Worker reaches it | [architecture](architecture.md#components) |
