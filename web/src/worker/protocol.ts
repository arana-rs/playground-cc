// The messages between the UI and the Worker loop (design/worker-protocol.md). Each one is a plain
// object with a `type`, and every message about a run carries its `runId`.
import type { Diagnostic, SourceInput } from 'engine';

/** UI to Worker: start a run, or stop it between two steps. */
export type ToWorker =
  | { type: 'run'; runId: number; files: SourceInput[] }
  | { type: 'stop'; runId: number };

/** How a run ended: on its own, with a diagnostic, or stopped. */
export type RunEnded =
  | { reason: 'exit'; status: number }
  | { reason: 'diagnostic'; diagnostic: Diagnostic }
  | { reason: 'stopped' };

/** Worker to UI: program output, then the run's end, its last message. */
export type FromWorker =
  | { type: 'output'; runId: number; text: string }
  | ({ type: 'ended'; runId: number } & RunEnded);

/** The diagnostic of a failure in the engine or the Worker, never in the program (design/errors.md). */
export const ENGINE_INTERNAL: Diagnostic = { code: 'engine.internal', args: {} };
