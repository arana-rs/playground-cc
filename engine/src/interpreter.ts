// The resumable interpreter: it runs the instructions of `bytecode.ts` one at a time, with every
// frame, value and position in its own arrays, so it pauses between any two steps and resumes
// from there (design/engine.md#execution-model).
import { type ArithmeticOperator, compile, type Instruction, startup } from './bytecode';
import { type FunctionSymbol, INT_MAX, INT_MIN, type Program } from './checker';
import { DiagnosticError } from './diagnostic';
import type { Limits } from './limits';
import type { Steps } from './steps';

/** A value: an `int`, a string literal's bytes as a library argument, or none yet. */
type Value = number | Uint8Array | undefined;

interface Frame {
  code: Instruction[];
  pc: number;
  /** Where its slots start in the locals. */
  base: number;
  /** Its size on the stack in bytes. */
  bytes: number;
  /** Whether the caller uses its value. */
  used: boolean;
}

/** The return address and the saved frame pointer, as on x86-64 (design/memory.md). */
const FRAME_OVERHEAD = 16;
const INT_SIZE = 4;

/** A part of the run a later step of phase 0.1 builds. */
function later(what: string, step: string): never {
  throw new Error(`not implemented yet: ${what} arrives in step ${step}`);
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
    this.#frames = [{ code: startup(program.main), pc: 0, base: 0, bytes: 0, used: true }];
  }

  /**
   * Runs until the step count reaches `pauseAt` or the program ends. Returns the exit status
   * once it has ended, undefined while it is paused.
   */
  advance(pauseAt: number): number | undefined {
    while (this.#status === undefined && this.#steps.used < pauseAt) this.#execute();
    return this.#status;
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
      case 'load':
        values.push(this.#read(frame, instruction.slot));
        return;
      case 'store': {
        const value = this.#int(values.pop());
        this.#locals[frame.base + instruction.slot] = value;
        values.push(value);
        return;
      }
      case 'compound': {
        const right = this.#int(values.pop());
        const left = this.#read(frame, instruction.slot);
        const value = arithmetic(instruction.operator, left, right);
        this.#locals[frame.base + instruction.slot] = value;
        values.push(value);
        return;
      }
      case 'increment': {
        const old = this.#read(frame, instruction.slot);
        const value = checked(old + instruction.delta);
        this.#locals[frame.base + instruction.slot] = value;
        values.push(instruction.prefix ? value : old);
        return;
      }
      case 'unary': {
        const operand = this.#int(values.pop());
        if (instruction.operator === '!') values.push(operand === 0 ? 1 : 0);
        else values.push(instruction.operator === '-' ? checked(-operand) : operand);
        return;
      }
      case 'binary': {
        const right = this.#int(values.pop());
        const left = this.#int(values.pop());
        values.push(arithmetic(instruction.operator, left, right));
        return;
      }
      case 'logical': {
        const left = this.#int(values.pop());
        if ((left === 0) === (instruction.operator === '&&')) {
          values.push(left === 0 ? 0 : 1);
          frame.pc = instruction.target;
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
        if (frame.used) later('ub.missing_return', '0.0.8');
        this.#return(undefined);
        return;
      case 'exit':
        this.#status = exitStatus(this.#int(values.pop()));
        return;
    }
  }

  /** A variable's value, which must have been written. */
  #read(frame: Frame, slot: number): number {
    const value = this.#locals[frame.base + slot];
    if (value === undefined) later('ub.uninitialized_read', '0.0.8');
    return value as number;
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
      throw new DiagnosticError({
        code: 'limit.stack',
        args: { limit: this.#limits.stack },
        range: call.range,
      });
    }
    this.#stackBytes += bytes;
    const base = this.#locals.length;
    this.#locals.push(...args);
    this.#locals.length = base + fn.locals.length;
    this.#frames.push({ code, pc: 0, base, bytes, used: call.used });
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

/** The status Linux reports: the value modulo 256 (design/language.md#supported-by-phase). */
function exitStatus(value: number): number {
  return ((value % 256) + 256) % 256;
}

/** An `int` result, which must be in range. */
function checked(value: number): number {
  if (value < INT_MIN || value > INT_MAX) later('ub.signed_overflow', '0.0.8');
  return value === 0 ? 0 : value;
}

function arithmetic(operator: ArithmeticOperator, left: number, right: number): number {
  switch (operator) {
    case '+':
      return checked(left + right);
    case '-':
      return checked(left - right);
    case '*':
      // Out of range, the rounded product is out of range too; in range, it is exact.
      return checked(left * right);
    case '/':
    case '%': {
      if (right === 0) later('ub.division_by_zero', '0.0.8');
      // INT_MIN / -1 overflows, and so does INT_MIN % -1.
      const quotient = checked(Math.trunc(left / right));
      return operator === '/' ? quotient : checked(left % right);
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
