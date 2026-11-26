import { DiagnosticError, type Range } from './diagnostic';

/** Counts the steps of a run against its budget (design/engine.md#execution-model). */
export class Steps {
  used = 0;

  constructor(readonly budget: number) {}

  /**
   * Charges `count` steps before the work they pay for; past the budget, ends with `limit.steps`
   * at `range`, the place of that work.
   */
  charge(count = 1, range?: Range): void {
    if (count > this.budget - this.used) {
      throw new DiagnosticError({
        code: 'limit.steps',
        args: { limit: this.budget },
        ...(range && { range }),
      });
    }
    this.used += count;
  }
}
