// Run limits, fixed by the release; the values and their status live in design/limits.md.

export interface Limits {
  /** Step budget, before the run and during it (`limit.steps`). */
  steps: number;
  /** Source size in UTF-8 bytes, all files together (`limit.source`). */
  source: number;
}

export const LIMITS: Readonly<Limits> = {
  steps: 100_000_000, // provisional
  source: 256 * 1024, // provisional
};
