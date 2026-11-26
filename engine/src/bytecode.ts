// Turns a checked function into instructions for the interpreter: a flat list, so the run's
// whole state is a few indexes and arrays, never the JavaScript call stack
// (design/engine.md#execution-model).
import type { BinaryOperator, Block, Declaration, Expression, Statement } from './ast';
import { constantValue, type FunctionSymbol, type Program, type VariableSymbol } from './checker';
import type { Range } from './diagnostic';
import { conflicts, isUnsequenced } from './sequencing';

export type ArithmeticOperator = Exclude<BinaryOperator, ',' | '&&' | '||'>;

/**
 * One instruction. Those with a `range` charge one step there before their work: an operator,
 * a statement's control transfer, a call, a return, or creating a local's block.
 */
export type Instruction =
  | { op: 'constant'; value: number }
  | { op: 'string'; bytes: Uint8Array }
  /** Reads a variable, which charges no step; `at` is its name, for a diagnostic. */
  | { op: 'load'; slot: number; at: Range; checks?: Check[] }
  /** `=`: stores the value and keeps it as the expression's. */
  | { op: 'store'; slot: number; range: Range; checks?: Check[] }
  | {
      op: 'compound';
      operator: ArithmeticOperator;
      slot: number;
      range: Range;
      checks?: Check[];
    }
  | {
      op: 'increment';
      delta: 1 | -1;
      prefix: boolean;
      slot: number;
      range: Range;
      checks?: Check[];
    }
  | { op: 'unary'; operator: '+' | '-' | '!'; range: Range }
  | { op: 'binary'; operator: ArithmeticOperator; range: Range }
  /** `&&` or `||` after its left operand: when that decides, the result and a jump past the right. */
  | {
      op: 'logical';
      operator: '&&' | '||';
      target: number;
      range: Range;
      /**
       * Marks of `=` its left operand wrote: when the right operand is evaluated, a sequence point
       * comes between them and the `=` no longer conflicts with those writes.
       */
      clears?: number[];
    }
  /** The right operand of `&&` or `||` as 0 or 1. */
  | { op: 'truth' }
  /** Jumps when the value is zero: a statement's test, or `?:`'s. */
  | { op: 'branch'; target: number; range: Range }
  /** A statement's jump (`break`, `continue`, a `for` without a test); free with no range. */
  | { op: 'jump'; target: number; range?: Range }
  | { op: 'switch'; cases: Map<number, number>; otherwise: number; range: Range }
  /** Drops an expression statement's value. */
  | { op: 'pop' }
  /** The comma operator: drops its left operand's value. */
  | { op: 'comma'; range: Range }
  /** Creates a local's block: uninitialized, or with the value of its initializer. */
  | { op: 'declare'; slot: number; initialized: boolean; range: Range }
  /** The end of the scope of the locals in slots `from` to `to`: their blocks die. */
  | { op: 'leave'; from: number; to: number }
  /** A call; `used` says whether its value is used. */
  | { op: 'call'; fn: FunctionSymbol; args: number; used: boolean; range: Range }
  | { op: 'return'; value: boolean; range: Range }
  /** The end of a function returning `int` other than `main`, reached without `return`. */
  | { op: 'missing_return'; range: Range }
  /** The end of the startup code: the run ends with the status `main` returned. */
  | { op: 'exit' }
  /** The start of a full expression whose accesses are checked for sequencing. */
  | { op: 'sequence' };

/**
 * One check of an access against the others under an operator whose operands are unsequenced
 * (design/language.md#undefined-behavior). The access is in the operator's operand `child`; it
 * is unsequenced with an earlier access in an earlier operand when either of them writes. `mark`
 * and `mark + 1` hold the first operand that read, and that wrote, the variable in this
 * evaluation of the full expression.
 */
export interface Check {
  mark: number;
  child: number;
  reads: boolean;
  writes: boolean;
}

/** An operator on the way from a full expression down to the operand being compiled. */
interface Step {
  node: Expression;
  child: number;
}

/** A loop or `switch` that `break` and `continue` leave. */
interface Jumps {
  kind: 'loop' | 'switch';
  /** The first slot declared inside it, which a jump out of it ends. */
  slots: number;
  breaks: Instruction[];
  continues: Instruction[];
  /** For a `switch`: its case labels and their targets. */
  cases?: Map<number, number>;
  otherwise?: number;
}

/** The code that calls `main` and ends the run with its status (design/language.md). */
export function startup(main: FunctionSymbol): Instruction[] {
  const range = main.definition?.declarator.nameRange as Range;
  return [{ op: 'call', fn: main, args: 0, used: true, range }, { op: 'exit' }];
}

export function compile(program: Program, fn: FunctionSymbol): Instruction[] {
  return new Compiler(program, fn).code;
}

class Compiler {
  readonly code: Instruction[] = [];
  readonly #program: Program;
  readonly #jumps: Jumps[] = [];
  /** Slots declared so far, in the order the checker gave them. */
  #slots: number;
  /** In the full expression being compiled: where accesses may be unsequenced, and the path. */
  #conflicts = new Map<Expression, Set<number>>();
  readonly #path: Step[] = [];
  readonly #marks = new Map<Expression, Map<number, number>>();
  /** For each `&&` and `||`, the marks its `clears` will hold. */
  readonly #clears = new Map<Expression, Set<number>>();
  #markCount = 0;

  constructor(program: Program, fn: FunctionSymbol) {
    this.#program = program;
    const definition = fn.definition;
    if (definition === undefined) throw new Error(`${fn.name} has no definition`);
    this.#slots = definition.declarator.functions[0]?.params.length ?? 0;
    this.#items(definition.body);
    const end = definition.body.range.end;
    const range: Range = { ...definition.body.range, start: { ...end, column: end.column - 1 } };
    if (fn.name === 'main') {
      // Reaching the end of `main` returns 0.
      this.#emit({ op: 'constant', value: 0 });
      this.#emit({ op: 'return', value: true, range });
    } else if (fn.type.returns === 'int') this.#emit({ op: 'missing_return', range });
    else this.#emit({ op: 'return', value: false, range });
  }

  #emit<T extends Instruction>(instruction: T): T {
    this.code.push(instruction);
    return instruction;
  }

  #variable(node: object): VariableSymbol {
    const symbol = this.#program.symbols.get(node);
    if (symbol?.kind !== 'variable') throw new Error('not a variable');
    return symbol;
  }

  // Statements.

  #items(block: Block): void {
    for (const item of block.items) {
      if (item.kind === 'declaration') this.#declaration(item);
      else if (item.kind !== 'include') this.#statement(item);
    }
  }

  #declaration(declaration: Declaration): void {
    for (const declarator of declaration.declarators) {
      if (declarator.functions.length > 0) continue;
      const { slot } = this.#variable(declarator);
      if (slot !== this.#slots) throw new Error('slots out of order');
      this.#slots++;
      const init = declarator.init?.kind === 'list' ? declarator.init.items[0] : declarator.init;
      if (init !== undefined && init.kind !== 'list') this.#full(init, true);
      this.#emit({ op: 'declare', slot, initialized: init !== undefined, range: declarator.range });
    }
  }

  /** The end of a scope that began when `from` slots were declared. */
  #leave(from: number): void {
    if (this.#slots > from) this.#emit({ op: 'leave', from, to: this.#slots });
  }

  #patch(instructions: Instruction[], target: number): void {
    for (const instruction of instructions) (instruction as { target: number }).target = target;
  }

  #innermost(kind: Jumps['kind']): Jumps {
    for (let i = this.#jumps.length - 1; i >= 0; i--) {
      const jumps = this.#jumps[i] as Jumps;
      if (jumps.kind === kind) return jumps;
    }
    throw new Error(`no ${kind} around`);
  }

  #loop(): Jumps {
    const jumps: Jumps = { kind: 'loop', slots: this.#slots, breaks: [], continues: [] };
    this.#jumps.push(jumps);
    return jumps;
  }

  #statement(statement: Statement): void {
    switch (statement.kind) {
      case 'block': {
        const from = this.#slots;
        this.#items(statement);
        this.#leave(from);
        return;
      }
      case 'expression':
        this.#full(statement.expression, false);
        this.#emit({ op: 'pop' });
        return;
      case 'empty':
        return;
      case 'if': {
        this.#full(statement.test, true);
        const branch = this.#emit({ op: 'branch', target: 0, range: statement.test.range });
        this.#statement(statement.consequent);
        if (statement.alternative === undefined) {
          branch.target = this.code.length;
          return;
        }
        const skip = this.#emit({ op: 'jump', target: 0 });
        branch.target = this.code.length;
        this.#statement(statement.alternative);
        skip.target = this.code.length;
        return;
      }
      case 'while': {
        const jumps = this.#loop();
        const top = this.code.length;
        this.#full(statement.test, true);
        const branch = this.#emit({ op: 'branch', target: 0, range: statement.test.range });
        this.#statement(statement.body);
        this.#emit({ op: 'jump', target: top });
        this.#jumps.pop();
        this.#patch(jumps.continues, top);
        this.#patch([branch, ...jumps.breaks], this.code.length);
        return;
      }
      case 'do': {
        const jumps = this.#loop();
        const top = this.code.length;
        this.#statement(statement.body);
        this.#patch(jumps.continues, this.code.length);
        this.#full(statement.test, true);
        const branch = this.#emit({ op: 'branch', target: 0, range: statement.test.range });
        this.#emit({ op: 'jump', target: top });
        this.#jumps.pop();
        this.#patch([branch, ...jumps.breaks], this.code.length);
        return;
      }
      case 'for': {
        const from = this.#slots;
        if (statement.init?.kind === 'declaration') this.#declaration(statement.init);
        else if (statement.init !== undefined) {
          this.#full(statement.init, false);
          this.#emit({ op: 'pop' });
        }
        const jumps = this.#loop();
        const top = this.code.length;
        let branch: Instruction | undefined;
        if (statement.test !== undefined) {
          this.#full(statement.test, true);
          branch = this.#emit({ op: 'branch', target: 0, range: statement.test.range });
        }
        this.#statement(statement.body);
        this.#patch(jumps.continues, this.code.length);
        if (statement.step !== undefined) {
          this.#full(statement.step, false);
          this.#emit({ op: 'pop' });
        }
        // Without a test, each iteration's step is the jump back.
        this.#emit({
          op: 'jump',
          target: top,
          ...(branch === undefined && { range: statement.range }),
        });
        this.#jumps.pop();
        this.#patch(
          branch === undefined ? jumps.breaks : [branch, ...jumps.breaks],
          this.code.length,
        );
        this.#leave(from);
        return;
      }
      case 'switch': {
        this.#full(statement.test, true);
        const dispatch = this.#emit({
          op: 'switch',
          cases: new Map(),
          otherwise: 0,
          range: statement.test.range,
        });
        const jumps: Jumps = {
          kind: 'switch',
          slots: this.#slots,
          breaks: [],
          continues: [],
          cases: dispatch.cases,
        };
        this.#jumps.push(jumps);
        this.#statement(statement.body);
        this.#jumps.pop();
        const end = this.code.length;
        dispatch.otherwise = jumps.otherwise ?? end;
        this.#patch(jumps.breaks, end);
        return;
      }
      case 'case':
      case 'default': {
        const jumps = this.#innermost('switch');
        if (statement.kind === 'case') {
          jumps.cases?.set(constantValue(statement.value), this.code.length);
        } else jumps.otherwise = this.code.length;
        this.#statement(statement.body);
        return;
      }
      case 'break':
      case 'continue': {
        const jumps =
          statement.kind === 'break' ? (this.#jumps.at(-1) as Jumps) : this.#innermost('loop');
        this.#leave(jumps.slots);
        const jump = this.#emit({ op: 'jump', target: 0, range: statement.range });
        (statement.kind === 'break' ? jumps.breaks : jumps.continues).push(jump);
        return;
      }
      case 'return':
        if (statement.value !== undefined) this.#full(statement.value, true);
        this.#emit({ op: 'return', value: statement.value !== undefined, range: statement.range });
        return;
    }
  }

  // Expressions: each leaves exactly one value. `used` says whether that value is used.

  /** A full expression: the end of one is a sequence point. */
  #full(expression: Expression, used: boolean): void {
    this.#conflicts = conflicts(expression, (name) => this.#variable(name).slot);
    if (this.#conflicts.size > 0) this.#emit({ op: 'sequence' });
    this.#expression(expression, used);
    this.#conflicts = new Map();
  }

  /** The operand `child` of `node`. */
  #operand(node: Expression, child: number, operand: Expression, used: boolean): void {
    this.#path.push({ node, child });
    this.#expression(operand, used);
    this.#path.pop();
  }

  #mark(node: Expression, slot: number): number {
    const marks = this.#marks.get(node) ?? new Map<number, number>();
    this.#marks.set(node, marks);
    let mark = marks.get(slot);
    if (mark === undefined) {
      mark = this.#markCount;
      this.#markCount += 2;
      marks.set(slot, mark);
    }
    return mark;
  }

  /**
   * The checks of an access to `slot` under each operator above it whose operands may access
   * that variable unsequenced. `own` is the assignment whose update this access is.
   */
  #checks(slot: number, reads: boolean, writes: boolean, own?: Expression): Check[] | undefined {
    if (this.#conflicts.size === 0) return undefined;
    const checks: Check[] = [];
    // An assignment's update comes after its operand, as the operand after `child` 0.
    if (own !== undefined && this.#conflicts.get(own)?.has(slot)) {
      checks.push({ mark: this.#mark(own, slot), child: 1, reads: false, writes: true });
    }
    // Whether a sequence point lies between the access and the operator being looked at, and
    // the `&&` and `||` whose left operand holds the access: their sequence point comes only
    // when they evaluate their right operand (C17 6.5.13p4).
    let sequenced = false;
    const logicals: Expression[] = [];
    for (let i = this.#path.length - 1; i >= 0; i--) {
      const { node, child } = this.#path[i] as Step;
      if (this.#conflicts.get(node)?.has(slot)) {
        if (isUnsequenced(node)) {
          checks.push({ mark: this.#mark(node, slot), child, reads, writes });
        } else if (node.kind === 'assign' && writes && (node.operator !== '=' || !sequenced)) {
          const mark = this.#mark(node, slot);
          checks.push({ mark, child: 0, reads: false, writes: true });
          if (node.operator === '=') {
            for (const logical of logicals) {
              const clears = this.#clears.get(logical) ?? new Set();
              clears.add(mark + 1);
              this.#clears.set(logical, clears);
            }
          }
        }
      }
      if (child !== 0 || isUnsequenced(node)) {
        if (node.kind === 'call') sequenced = true;
      } else if (node.kind === 'binary' && node.operator !== ',') logicals.push(node);
      else if (node.kind === 'binary' || node.kind === 'conditional') sequenced = true;
    }
    return checks.length > 0 ? checks : undefined;
  }

  #expression(expression: Expression, used: boolean): void {
    switch (expression.kind) {
      case 'constant':
        this.#emit({ op: 'constant', value: expression.value });
        return;
      case 'string':
        this.#emit({ op: 'string', bytes: expression.bytes });
        return;
      case 'name': {
        const { slot } = this.#variable(expression);
        const checks = this.#checks(slot, true, false);
        this.#emit({ op: 'load', slot, at: expression.range, ...(checks && { checks }) });
        return;
      }
      case 'unary':
        this.#operand(expression, 0, expression.operand, true);
        this.#emit({ op: 'unary', operator: expression.operator, range: expression.range });
        return;
      case 'increment': {
        const { slot } = this.#variable(expression.operand);
        const checks = this.#checks(slot, true, true);
        this.#emit({
          op: 'increment',
          delta: expression.operator === '++' ? 1 : -1,
          prefix: expression.prefix,
          slot,
          range: expression.range,
          ...(checks && { checks }),
        });
        return;
      }
      case 'binary': {
        const { operator } = expression;
        if (operator === ',') {
          this.#operand(expression, 0, expression.left, false);
          this.#emit({ op: 'comma', range: expression.range });
          this.#operand(expression, 1, expression.right, used);
          return;
        }
        this.#operand(expression, 0, expression.left, true);
        if (operator === '&&' || operator === '||') {
          const clears = this.#clears.get(expression);
          const logical = this.#emit({
            op: 'logical',
            operator,
            target: 0,
            range: expression.range,
            ...(clears && { clears: [...clears] }),
          });
          this.#operand(expression, 1, expression.right, true);
          this.#emit({ op: 'truth' });
          logical.target = this.code.length;
          return;
        }
        this.#operand(expression, 1, expression.right, true);
        this.#emit({ op: 'binary', operator, range: expression.range });
        return;
      }
      case 'assign': {
        const { slot } = this.#variable(expression.target);
        this.#operand(expression, 0, expression.value, true);
        const { range } = expression;
        if (expression.operator === '=') {
          const checks = this.#checks(slot, false, true, expression);
          this.#emit({ op: 'store', slot, range, ...(checks && { checks }) });
        } else {
          const operator = expression.operator.slice(0, -1) as ArithmeticOperator;
          const checks = this.#checks(slot, true, true, expression);
          this.#emit({ op: 'compound', operator, slot, range, ...(checks && { checks }) });
        }
        return;
      }
      case 'conditional': {
        this.#operand(expression, 0, expression.test, true);
        const branch = this.#emit({ op: 'branch', target: 0, range: expression.range });
        this.#operand(expression, 1, expression.consequent, used);
        const skip = this.#emit({ op: 'jump', target: 0 });
        branch.target = this.code.length;
        this.#operand(expression, 2, expression.alternative, used);
        skip.target = this.code.length;
        return;
      }
      case 'call': {
        const fn = this.#program.symbols.get(expression.callee);
        if (fn?.kind !== 'function') throw new Error('not a function');
        for (const [i, arg] of expression.args.entries()) this.#operand(expression, i, arg, true);
        this.#emit({ op: 'call', fn, args: expression.args.length, used, range: expression.range });
        return;
      }
    }
  }
}
