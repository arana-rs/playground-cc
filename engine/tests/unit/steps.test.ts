import { describe, expect, it } from 'vitest';
import { DiagnosticError } from '../../src/diagnostic';
import { Steps } from '../../src/steps';

function chargeError(steps: Steps, count: number): unknown {
  try {
    steps.charge(count);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('Steps', () => {
  it('counts the steps charged', () => {
    const steps = new Steps(10);
    steps.charge();
    steps.charge(4);
    expect(steps.used).toBe(5);
  });

  it('allows using the whole budget', () => {
    const steps = new Steps(10);
    steps.charge(10);
    expect(steps.used).toBe(10);
  });

  it('stops right after the budget is used up', () => {
    const steps = new Steps(10);
    steps.charge(10);
    expect(chargeError(steps, 1)).toBeInstanceOf(DiagnosticError);
  });

  it('allows a budget of zero to charge nothing', () => {
    const steps = new Steps(0);
    steps.charge(0);
    expect(chargeError(steps, 1)).toBeInstanceOf(DiagnosticError);
  });

  it('ends with limit.steps before the work that would pass the budget', () => {
    const steps = new Steps(10);
    steps.charge(8);
    const error = chargeError(steps, 3);
    expect(error).toBeInstanceOf(DiagnosticError);
    expect((error as DiagnosticError).diagnostic).toEqual({
      code: 'limit.steps',
      args: { limit: 10 },
    });
    expect(steps.used).toBe(8);
  });
});
