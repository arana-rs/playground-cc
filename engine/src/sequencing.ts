// Which variables a full expression may access without sequencing, as C17 6.5p2 has it: a
// modification unsequenced with another modification or with a read of the same variable
// (design/language.md#undefined-behavior). The analysis looks at every operand, evaluated or
// not; the run then checks only what it evaluates.
import type { Expression } from './ast';

/** The variables an expression reads and writes, each by its slot. */
interface Accesses {
  reads: Set<number>;
  writes: Set<number>;
  /** Writes not sequenced before the expression's value is computed. */
  loose: Set<number>;
}

/** An operator whose operands are unsequenced: arithmetic, comparison, a call's arguments. */
export function isUnsequenced(expression: Expression): boolean {
  return (
    expression.kind === 'call' ||
    (expression.kind === 'binary' && !['&&', '||', ','].includes(expression.operator))
  );
}

/**
 * The operators of a full expression where two of its accesses to a variable may be unsequenced,
 * each with those variables' slots. `slot` gives the slot of a variable's name.
 */
export function conflicts(
  expression: Expression,
  slot: (name: Expression) => number,
): Map<Expression, Set<number>> {
  const found = new Map<Expression, Set<number>>();
  const add = (node: Expression, variable: number) => {
    const set = found.get(node) ?? new Set();
    set.add(variable);
    found.set(node, set);
  };

  const visit = (node: Expression): Accesses => {
    switch (node.kind) {
      case 'constant':
      case 'string':
        return { reads: new Set(), writes: new Set(), loose: new Set() };
      case 'name':
        return { reads: new Set([slot(node)]), writes: new Set(), loose: new Set() };
      case 'increment': {
        const variable = slot(node.operand);
        return {
          reads: new Set([variable]),
          writes: new Set([variable]),
          loose: new Set([variable]),
        };
      }
      case 'unary':
        return visit(node.operand);
      case 'assign': {
        const value = visit(node.value);
        const target = slot(node.target);
        // `=` updates its variable after its operand's value is computed, not after that
        // operand's side effects; a compound assignment also reads it, unsequenced with them all.
        const conflict = node.operator === '=' ? value.loose.has(target) : value.writes.has(target);
        if (conflict) add(node, target);
        if (node.operator !== '=') value.reads.add(target);
        value.writes.add(target);
        value.loose.add(target);
        return value;
      }
      case 'conditional': {
        const [test, consequent, alternative] = [
          visit(node.test),
          visit(node.consequent),
          visit(node.alternative),
        ];
        // The test is sequenced before either branch, and only one branch is evaluated.
        return {
          reads: union(test.reads, consequent.reads, alternative.reads),
          writes: union(test.writes, consequent.writes, alternative.writes),
          loose: union(consequent.loose, alternative.loose),
        };
      }
      case 'binary':
      case 'call': {
        const operands =
          node.kind === 'call' ? node.args.map(visit) : [visit(node.left), visit(node.right)];
        const reads = union(...operands.map((o) => o.reads));
        const writes = union(...operands.map((o) => o.writes));
        if (!isUnsequenced(node)) {
          // `,` sequences its left operand before its right one; `&&` and `||` only when they
          // evaluate the right one (C17 6.5.13p4), so the left one's writes may stay loose.
          const [left, right] = operands as [Accesses, Accesses];
          const comma = node.kind === 'binary' && node.operator === ',';
          const loose = comma ? right.loose : union(left.loose, right.loose);
          return { reads, writes, loose };
        }
        for (const variable of writes) {
          const touching = operands.filter((o) => o.reads.has(variable) || o.writes.has(variable));
          if (touching.length > 1) add(node, variable);
        }
        // A call's arguments are all evaluated before the call returns its value.
        const loose =
          node.kind === 'call' ? new Set<number>() : union(...operands.map((o) => o.loose));
        return { reads, writes, loose };
      }
    }
  };

  visit(expression);
  return found;
}

function union(...sets: Set<number>[]): Set<number> {
  const result = new Set<number>();
  for (const set of sets) for (const value of set) result.add(value);
  return result;
}
