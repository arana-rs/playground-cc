// The resumable interpreter: it runs the instructions of `bytecode.ts` one at a time, with every
// frame, value and position in its own arrays, so it pauses between any two steps and resumes
// from there (design/engine.md#execution-model).
import {
  type ArithmeticOperator,
  type Check,
  compile,
  type Instruction,
  startup,
} from './bytecode';
import { type FunctionSymbol, INT_MAX, INT_MIN, type Program } from './checker';
import { type Diagnostic, DiagnosticError, type Range, type Stack } from './diagnostic';
import type { Limits } from './limits';
import type { Steps } from './steps';

/** A value: an `int`, a string literal's bytes as a library argument, or none yet. */
type Value = number | Uint8Array | undefined;

interface Frame {
  /** Its function; none for the startup code. */
  fn: FunctionSymbol | undefined;
  /** The call that made it. */
  call: Range;
  code: Instruction[];
  pc: number;
  /** Where its slots start in the locals. */
  base: number;
  /** Its size on the stack in bytes. */
  bytes: number;
  /** Whether the caller uses its value. */
  used: boolean;
  /** The evaluation of a checked full expression it is in, and what each mark saw in it. */
  epoch: number;
  epochs: number[];
  children: number[];
}

/** The return address and the saved frame pointer, as on x86-64 (design/memory.md). */
const FRAME_OVERHEAD = 16;
const INT_SIZE = 4;

/** A part of the run a later step of phase 0.1 builds. */
function later(what: string, step: string): never {
  throw new Error(`not implemented yet: ${what} arrives in step ${step}`);
}

function fail(code: Diagnostic['code'], range: Range, args: Diagnostic['args'] = {}): never {
  throw new DiagnosticError({ code, args, range });
}

export class Interpreter {
  readonly #program: Program;
  readonly #steps: Steps;
  readonly #limits: Readonly<Limits>;
  readonly #code = new Map<FunctionSymbol, Instruction[]>();
  readonly #frames: Frame[];
  readonly #locals: Value[] = [];
  readonly #values: Value[] = [];
  #stackBytes = 0;
  #status: number | undefined;

  constructor(program: Program, steps: Steps, limits: Readonly<Limits>) {
    this.#program = program;
    this.#steps = steps;
    this.#limits = limits;
    // The startup code calls `main`: its frame is not the program's and takes no stack.
    const code = startup(program.main);
    const call = (code[0] as Instruction & { op: 'call' }).range;
    this.#frames = [frame(undefined, call, code, 0, 0, true)];
  }

  /**
   * Runs until the step count reaches `pauseAt` or the program ends. Returns the exit status
   * once it has ended, undefined while it is paused. A diagnostic gets the call stack.
   */
  advance(pauseAt: number): number | undefined {
    try {
      while (this.#status === undefined && this.#steps.used < pauseAt) this.#execute();
    } catch (error) {
      if (!(error instanceof DiagnosticError)) throw error;
      const { diagnostic } = error;
      throw new DiagnosticError({ ...diagnostic, stack: this.#stack(diagnostic.range as Range) });
    }
    return this.#status;
  }

  /** The program's frames, innermost first: each at `range`, then at its callee's call. */
  #stack(range: Range): Stack {
    const frames = [];
    const total = this.#frames.length - 1;
    for (let i = total; i >= 1 && frames.length < this.#limits.frames; i--) {
      const at = i === total ? range : (this.#frames[i + 1] as Frame).call;
      frames.push({ function: (this.#frames[i] as Frame).fn?.name as string, range: at });
    }
    return { frames, total };
  }

  #execute(): void {
    const frame = this.#frames[this.#frames.length - 1] as Frame;
    const instruction = frame.code[frame.pc++] as Instruction;
    const values = this.#values;
    if ('range' in instruction && instruction.range !== undefined) {
      this.#steps.charge(1, instruction.range);
    }
    switch (instruction.op) {
      case 'constant':
        values.push(instruction.value);
        return;
      case 'string':
        values.push(instruction.bytes);
        return;
      case 'load': {
        const value = this.#read(frame, instruction.slot, instruction.at);
        this.#sequence(frame, instruction, instruction.at);
        values.push(value);
        return;
      }
      case 'store': {
        const value = this.#int(values.pop());
        this.#sequence(frame, instruction, instruction.range);
        this.#locals[frame.base + instruction.slot] = value;
        values.push(value);
        return;
      }
      case 'compound': {
        const right = this.#int(values.pop());
        const left = this.#read(frame, instruction.slot, instruction.range);
        this.#sequence(frame, instruction, instruction.range);
        const value = arithmetic(instruction.operator, left, right, instruction.range);
        this.#locals[frame.base + instruction.slot] = value;
        values.push(value);
        return;
      }
      case 'increment': {
        const old = this.#read(frame, instruction.slot, instruction.range);
        this.#sequence(frame, instruction, instruction.range);
        const value = checked(old + instruction.delta, instruction.range);
        this.#locals[frame.base + instruction.slot] = value;
        values.push(instruction.prefix ? value : old);
        return;
      }
      case 'unary': {
        const operand = this.#int(values.pop());
        if (instruction.operator === '!') values.push(operand === 0 ? 1 : 0);
        else if (instruction.operator === '-') values.push(checked(-operand, instruction.range));
        else values.push(operand);
        return;
      }
      case 'binary': {
        const right = this.#int(values.pop());
        const left = this.#int(values.pop());
        values.push(arithmetic(instruction.operator, left, right, instruction.range));
        return;
      }
      case 'logical': {
        const left = this.#int(values.pop());
        if ((left === 0) === (instruction.operator === '&&')) {
          values.push(left === 0 ? 0 : 1);
          frame.pc = instruction.target;
        } else if (instruction.clears !== undefined) {
          // The sequence point before the right operand orders the left one's writes first.
          for (const mark of instruction.clears) frame.epochs[mark] = -1;
        }
        return;
      }
      case 'truth':
        values.push(this.#int(values.pop()) === 0 ? 0 : 1);
        return;
      case 'branch':
        if (this.#int(values.pop()) === 0) frame.pc = instruction.target;
        return;
      case 'jump':
        frame.pc = instruction.target;
        return;
      case 'switch': {
        const value = this.#int(values.pop());
        frame.pc = instruction.cases.get(value) ?? instruction.otherwise;
        return;
      }
      case 'pop':
      case 'comma':
        values.pop();
        return;
      case 'declare':
        this.#locals[frame.base + instruction.slot] = instruction.initialized
          ? this.#int(values.pop())
          : undefined;
        return;
      case 'leave':
        this.#locals.fill(undefined, frame.base + instruction.from, frame.base + instruction.to);
        return;
      case 'call':
        this.#call(instruction);
        return;
      case 'return':
        this.#return(instruction.value ? this.#int(values.pop()) : undefined);
        return;
      case 'missing_return':
        this.#return(undefined);
        // The caller uses the value it never got: the error is at its call.
        if (frame.used) {
          fail('ub.missing_return', frame.call, { function: frame.fn?.name as string });
        }
        return;
      case 'sequence':
        frame.epoch++;
        return;
      case 'exit':
        this.#status = exitStatus(this.#int(values.pop()));
        return;
    }
  }

  /** A variable's value, which must have been written. */
  #read(frame: Frame, slot: number, range: Range): number {
    const value = this.#locals[frame.base + slot];
    if (value === undefined) {
      fail('ub.uninitialized_read', range, {
        name: (frame.fn as FunctionSymbol).locals[slot]?.name as string,
      });
    }
    return value as number;
  }

  /** Checks an access against the earlier ones of its full expression it is unsequenced with. */
  #sequence(frame: Frame, access: { slot: number; checks?: Check[] }, range: Range): void {
    if (access.checks === undefined) return;
    const { epoch, epochs, children } = frame;
    for (const check of access.checks) {
      const read = check.mark;
      const write = check.mark + 1;
      const before = (mark: number) =>
        epochs[mark] === epoch && (children[mark] as number) < check.child;
      if (before(write) || (check.writes && before(read))) {
        fail('ub.unsequenced', range, {
          name: (frame.fn as FunctionSymbol).locals[access.slot]?.name as string,
        });
      }
      for (const [mark, done] of [
        [read, check.reads],
        [write, check.writes],
      ] as const) {
        if (done && epochs[mark] !== epoch) {
          epochs[mark] = epoch;
          children[mark] = check.child;
        }
      }
    }
  }

  #int(value: Value): number {
    if (typeof value !== 'number') throw new Error('not an int');
    return value;
  }

  #call(call: Instruction & { op: 'call' }): void {
    const { fn } = call;
    const args = this.#values.splice(this.#values.length - call.args, call.args);
    if (fn.definition === undefined) {
      this.#library(fn, args);
      return;
    }
    let code = this.#code.get(fn);
    if (code === undefined) {
      code = compile(this.#program, fn);
      this.#code.set(fn, code);
    }
    // The whole frame is charged at the call, as a native frame is (design/memory.md).
    const bytes = FRAME_OVERHEAD + INT_SIZE * fn.locals.length;
    if (bytes > this.#limits.stack - this.#stackBytes) {
      fail('limit.stack', call.range, { limit: this.#limits.stack });
    }
    this.#stackBytes += bytes;
    const base = this.#locals.length;
    this.#locals.push(...args);
    this.#locals.length = base + fn.locals.length;
    this.#frames.push(frame(fn, call.range, code, base, bytes, call.used));
  }

  #return(value: number | undefined): void {
    const frame = this.#frames.pop() as Frame;
    this.#locals.length = frame.base;
    this.#stackBytes -= frame.bytes;
    this.#values.push(value);
  }

  #library(fn: FunctionSymbol, args: Value[]): void {
    if (fn.library?.name !== 'exit') later(`${fn.name}`, '0.0.9');
    this.#status = exitStatus(this.#int(args[0]));
  }
}

function frame(
  fn: FunctionSymbol | undefined,
  call: Range,
  code: Instruction[],
  base: number,
  bytes: number,
  used: boolean,
): Frame {
  return { fn, call, code, pc: 0, base, bytes, used, epoch: 0, epochs: [], children: [] };
}

/** The status Linux reports: the value modulo 256 (design/language.md#supported-by-phase). */
function exitStatus(value: number): number {
  return ((value % 256) + 256) % 256;
}

/** An `int` result, which must be in range. */
function checked(value: number, range: Range): number {
  if (value < INT_MIN || value > INT_MAX) fail('ub.signed_overflow', range, { type: 'int' });
  return value === 0 ? 0 : value;
}

function arithmetic(
  operator: ArithmeticOperator,
  left: number,
  right: number,
  range: Range,
): number {
  switch (operator) {
    case '+':
      return checked(left + right, range);
    case '-':
      return checked(left - right, range);
    case '*':
      // Out of range, the rounded product is out of range too; in range, it is exact.
      return checked(left * right, range);
    case '/':
    case '%': {
      if (right === 0) fail('ub.division_by_zero', range);
      // INT_MIN / -1 overflows, and so does INT_MIN % -1.
      const quotient = checked(Math.trunc(left / right), range);
      return operator === '/' ? quotient : checked(left % right, range);
    }
    case '==':
      return Number(left === right);
    case '!=':
      return Number(left !== right);
    case '<':
      return Number(left < right);
    case '>':
      return Number(left > right);
    case '<=':
      return Number(left <= right);
    case '>=':
      return Number(left >= right);
  }
}
