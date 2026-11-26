// Run limits, fixed by the release; the values and their status live in design/limits.md.

export interface Limits {
  /** Step budget, before the run and during it (`limit.steps`). */
  steps: number;
  /** Source size in UTF-8 bytes, all files together (`limit.source`). */
  source: number;
  /** Text length in characters: longer diagnostic string args are cut with `…` (a display cap). */
  text: number;
  /** Nesting depth of expressions, statements and declarators (`limit.nesting`). */
  nesting: number;
  /** Static data in bytes: globals, `static` variables and string literals (`limit.static_data`). */
  staticData: number;
  /** Stack size in bytes: a call whose frame does not fit stops the run (`limit.stack`). */
  stack: number;
  /** Stack frames listed in a diagnostic, innermost first; the total counts them all (a display cap). */
  frames: number;
}

export const LIMITS: Readonly<Limits> = {
  steps: 100_000_000, // provisional
  source: 256 * 1024, // provisional
  text: 200, // chosen
  nesting: 256, // provisional
  staticData: 16 * 1024 * 1024, // provisional
  stack: 8 * 1024 * 1024, // provisional
  frames: 100, // chosen
};
