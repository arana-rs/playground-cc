// The checker: names, types and the other constraints of the C that 0.1 accepts, before the run
// (design/language.md#checks). Like the parser, it is a generator that pauses between slices and
// charges one step per syntax node checked.
import type {
  Block,
  Declaration,
  Declarator,
  Expression,
  FunctionDefinition,
  Include,
  Initializer,
  Statement,
  TranslationUnit,
  TypeName,
} from './ast';
import { type DiagnosticCode, DiagnosticError, type Range } from './diagnostic';
import {
  HEADER_FUNCTIONS,
  isUnsupportedFunction,
  type LibraryFunction,
  type LibraryParameter,
  SUBSET_FUNCTIONS,
} from './library';
import type { Limits } from './limits';
import { span } from './parser';
import type { Steps } from './steps';

type Gen<T> = Generator<void, T, void>;

/** The type of an expression's value in 0.1: a string is a literal passed to a library function. */
type ValueType = 'int' | 'void' | 'string';

export interface FunctionType {
  returns: 'int' | 'void';
  params: LibraryParameter[];
  variadic: boolean;
}

export interface VariableSymbol {
  kind: 'variable';
  name: string;
  /** Its place among its function's parameters and locals, in declaration order. */
  slot: number;
  range: Range;
}

export interface FunctionSymbol {
  kind: 'function';
  name: string;
  type: FunctionType;
  /** Where it was first declared. */
  range: Range;
  definition?: FunctionDefinition;
  /** The library function it is, when the program does not define it. */
  library?: LibraryFunction;
  /** Parameters, then every local of the function, inner blocks included. */
  locals: VariableSymbol[];
}

export type Symbol = VariableSymbol | FunctionSymbol;

/** A checked program: each name, declarator and parameter mapped to the symbol it is. */
export interface Program {
  unit: TranslationUnit;
  main: FunctionSymbol;
  symbols: Map<object, Symbol>;
}

interface SwitchContext {
  values: Set<number>;
  hasDefault: boolean;
}

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

function error(
  code: DiagnosticCode,
  range: Range | undefined,
  args: Record<string, string | number> = {},
): DiagnosticError {
  return new DiagnosticError({ code, args, ...(range && { range }) });
}

function unsupported(construct: string, range: Range): DiagnosticError {
  return new DiagnosticError({ code: 'unsupported.construct', args: { construct }, range });
}

function sameType(a: FunctionType, b: FunctionType): boolean {
  return (
    a.returns === b.returns &&
    a.variadic === b.variadic &&
    a.params.length === b.params.length &&
    a.params.every((param, i) => param === b.params[i])
  );
}

export class Checker {
  /** The step count at which the checker pauses until the next slice. */
  pauseAt = 0;
  readonly #unit: TranslationUnit;
  readonly #steps: Steps;
  readonly #limits: Readonly<Limits>;
  readonly #scopes: Map<string, Symbol>[] = [];
  readonly #functions = new Map<string, FunctionSymbol>();
  /** Functions in the order of their first call, with where that call is. */
  readonly #called = new Map<FunctionSymbol, Range>();
  readonly #symbols = new Map<object, Symbol>();
  readonly #switches: SwitchContext[] = [];
  #function: FunctionSymbol | undefined;
  #returns: 'int' | 'void' = 'int';
  #loops = 0;
  #staticData = 0;

  constructor(unit: TranslationUnit, steps: Steps, limits: Readonly<Limits>) {
    this.#unit = unit;
    this.#steps = steps;
    this.#limits = limits;
  }

  *check(): Gen<Program> {
    this.#scopes.push(new Map());
    for (const item of this.#unit.items) {
      if (item.kind === 'include') yield* this.#include(item);
      else if (item.kind === 'declaration') yield* this.#declaration(item);
      else yield* this.#definition(item);
    }
    // What a linker would find: each function called must be defined or be the library's.
    for (const [fn, call] of this.#called) {
      if (fn.definition !== undefined || fn.library !== undefined) continue;
      const library = SUBSET_FUNCTIONS.get(fn.name);
      if (library !== undefined && sameType(fn.type, library)) fn.library = library;
      else if (isUnsupportedFunction(fn.name)) {
        throw error('unsupported.function', call, { name: fn.name });
      } else throw error('name.undefined_function', call, { name: fn.name });
    }
    const main = this.#functions.get('main');
    if (main?.definition === undefined) throw error('name.missing_main', undefined);
    if (this.#staticData > this.#limits.staticData) {
      throw error('limit.static_data', undefined, { limit: this.#limits.staticData });
    }
    return { unit: this.#unit, main, symbols: this.#symbols };
  }

  *#visit(range: Range): Gen<void> {
    this.#steps.charge(1, range);
    if (this.#steps.used >= this.pauseAt) yield;
  }

  // Scopes and symbols.

  get #scope(): Map<string, Symbol> {
    return this.#scopes[this.#scopes.length - 1] as Map<string, Symbol>;
  }

  /**
   * The symbol a name refers to. Calling an undeclared C17 library function outside the subset
   * is `unsupported.function`, not an undeclared name (design/libc.md#headers-and-functions).
   */
  #lookup(name: string, range: Range, called = false): Symbol {
    for (let i = this.#scopes.length - 1; i >= 0; i--) {
      const symbol = this.#scopes[i]?.get(name);
      if (symbol !== undefined) return symbol;
    }
    if (called && isUnsupportedFunction(name)) throw error('unsupported.function', range, { name });
    throw error('name.undeclared', range, { name });
  }

  /** Declares a function in the current scope; every declaration of it must have its type. */
  #declareFunction(name: string, type: FunctionType, range: Range): FunctionSymbol {
    let symbol = this.#functions.get(name);
    if (symbol === undefined) {
      symbol = { kind: 'function', name, type, range, locals: [] };
      this.#functions.set(name, symbol);
    } else {
      this.#steps.charge(1 + type.params.length, range);
      if (!sameType(symbol.type, type)) throw error('type.conflicting_types', range, { name });
    }
    if (this.#scope.get(name)?.kind === 'variable') throw error('name.redefined', range, { name });
    this.#scope.set(name, symbol);
    return symbol;
  }

  #declareVariable(name: string, range: Range): VariableSymbol {
    if (this.#scope.has(name)) throw error('name.redefined', range, { name });
    const fn = this.#function as FunctionSymbol;
    const symbol: VariableSymbol = { kind: 'variable', name, slot: fn.locals.length, range };
    fn.locals.push(symbol);
    this.#scope.set(name, symbol);
    return symbol;
  }

  // Declarations.

  *#include(include: Include): Gen<void> {
    yield* this.#visit(include.range);
    for (const library of HEADER_FUNCTIONS.get(include.header) ?? []) {
      const symbol = this.#declareFunction(library.name, library, include.range);
      // A function the program defines is its own, whatever its name.
      if (symbol.definition === undefined) symbol.library = library;
    }
  }

  /** The type a function declarator gives, checked. */
  #functionType(type: TypeName, declarator: Declarator): FunctionType {
    const [parameters, extra] = declarator.functions;
    if (parameters === undefined) throw new Error('not a function declarator');
    if (extra !== undefined) {
      throw error('type.function_returning_function', declarator.range, { name: declarator.name });
    }
    const names = new Set<string>();
    for (const param of parameters.params) {
      if (param.type.name === 'void') throw error('type.invalid_void_parameter', param.range);
      if (param.name === undefined) continue;
      if (names.has(param.name)) throw error('name.redefined', param.range, { name: param.name });
      names.add(param.name);
    }
    if (declarator.name === 'main') {
      if (type.name !== 'int' || parameters.params.length > 0 || parameters.variadic) {
        throw error('type.invalid_main', span(type.range, declarator.range));
      }
    }
    return {
      returns: type.name,
      params: parameters.params.map(() => 'int'),
      variadic: parameters.variadic,
    };
  }

  *#declaration(declaration: Declaration, inFor = false): Gen<void> {
    yield* this.#visit(declaration.range);
    for (const declarator of declaration.declarators) {
      yield* this.#visit(declarator.range);
      if (declarator.functions.length > 0) {
        if (inFor) throw error('syntax.for_declaration', declarator.range);
        if (declarator.init !== undefined) {
          throw error('type.invalid_initializer', declarator.init.range);
        }
        const type = this.#functionType(declaration.type, declarator);
        this.#declareFunction(declarator.name, type, declarator.nameRange);
        continue;
      }
      if (declaration.type.name === 'void') {
        throw error('type.void_object', declarator.nameRange, { name: declarator.name });
      }
      // The scope of a variable starts at the end of its declarator, before its initializer.
      this.#symbols.set(declarator, this.#declareVariable(declarator.name, declarator.nameRange));
      if (declarator.init !== undefined) yield* this.#initializer(declarator.init);
    }
  }

  /** A scalar's initializer: an expression, maybe in one pair of braces. */
  *#initializer(init: Initializer): Gen<void> {
    if (init.kind !== 'list') {
      yield* this.#value(init);
      return;
    }
    yield* this.#visit(init.range);
    const [item, extra] = init.items;
    if (item === undefined || extra !== undefined || item.kind === 'list') {
      throw error('type.invalid_initializer', init.range);
    }
    yield* this.#value(item);
  }

  *#definition(definition: FunctionDefinition): Gen<void> {
    yield* this.#visit(definition.range);
    const { declarator } = definition;
    const type = this.#functionType(definition.type, declarator);
    const symbol = this.#declareFunction(declarator.name, type, declarator.nameRange);
    if (symbol.definition !== undefined) {
      throw error('name.redefined', declarator.nameRange, { name: declarator.name });
    }
    symbol.definition = definition;
    symbol.library = undefined;
    this.#function = symbol;
    this.#returns = type.returns;
    // Parameters and the body's outermost declarations share one scope.
    this.#scopes.push(new Map());
    for (const param of declarator.functions[0]?.params ?? []) {
      yield* this.#visit(param.range);
      if (param.name === undefined) throw error('name.unnamed_parameter', param.range);
      this.#symbols.set(param, this.#declareVariable(param.name, param.range));
    }
    yield* this.#blockItems(definition.body);
    this.#scopes.pop();
    this.#function = undefined;
  }

  // Statements.

  *#blockItems(block: Block): Gen<void> {
    yield* this.#visit(block.range);
    for (const item of block.items) {
      if (item.kind === 'include') yield* this.#include(item);
      else if (item.kind === 'declaration') yield* this.#declaration(item);
      else yield* this.#statement(item);
    }
  }

  *#statement(statement: Statement): Gen<void> {
    switch (statement.kind) {
      case 'block':
        this.#scopes.push(new Map());
        yield* this.#blockItems(statement);
        this.#scopes.pop();
        return;
      case 'expression':
        yield* this.#visit(statement.range);
        yield* this.#expression(statement.expression);
        return;
      case 'empty':
        yield* this.#visit(statement.range);
        return;
      case 'if':
        yield* this.#visit(statement.range);
        yield* this.#value(statement.test);
        yield* this.#statement(statement.consequent);
        if (statement.alternative !== undefined) yield* this.#statement(statement.alternative);
        return;
      case 'while':
        yield* this.#visit(statement.range);
        yield* this.#value(statement.test);
        yield* this.#loopBody(statement.body);
        return;
      case 'do':
        yield* this.#visit(statement.range);
        yield* this.#loopBody(statement.body);
        yield* this.#value(statement.test);
        return;
      case 'for':
        yield* this.#visit(statement.range);
        this.#scopes.push(new Map());
        if (statement.init?.kind === 'declaration') yield* this.#declaration(statement.init, true);
        else if (statement.init !== undefined) yield* this.#expression(statement.init);
        if (statement.test !== undefined) yield* this.#value(statement.test);
        if (statement.step !== undefined) yield* this.#expression(statement.step);
        yield* this.#loopBody(statement.body);
        this.#scopes.pop();
        return;
      case 'switch':
        yield* this.#visit(statement.range);
        yield* this.#value(statement.test);
        this.#switches.push({ values: new Set(), hasDefault: false });
        yield* this.#statement(statement.body);
        this.#switches.pop();
        return;
      case 'case': {
        yield* this.#visit(statement.range);
        const context = this.#switches.at(-1);
        if (context === undefined) throw error('syntax.case_outside_switch', statement.label);
        // Checked as any expression first, so an unevaluated operand (`0 && x`) is checked too.
        yield* this.#value(statement.value);
        const value = constantValue(statement.value);
        if (context.values.has(value)) {
          throw error('type.duplicate_case', statement.value.range, { value });
        }
        context.values.add(value);
        yield* this.#statement(statement.body);
        return;
      }
      case 'default': {
        yield* this.#visit(statement.range);
        const context = this.#switches.at(-1);
        if (context === undefined) throw error('syntax.case_outside_switch', statement.label);
        if (context.hasDefault) throw error('syntax.duplicate_default', statement.label);
        context.hasDefault = true;
        yield* this.#statement(statement.body);
        return;
      }
      case 'break':
        yield* this.#visit(statement.range);
        if (this.#loops === 0 && this.#switches.length === 0) {
          throw error('syntax.break_outside_loop', statement.range);
        }
        return;
      case 'continue':
        yield* this.#visit(statement.range);
        if (this.#loops === 0) throw error('syntax.continue_outside_loop', statement.range);
        return;
      case 'return': {
        yield* this.#visit(statement.range);
        const name = (this.#function as FunctionSymbol).name;
        if (statement.value === undefined) {
          if (this.#returns === 'int') {
            throw error('type.missing_return_value', statement.range, { function: name });
          }
          return;
        }
        if (this.#returns === 'void') {
          throw error('type.return_value_in_void', statement.value.range, { function: name });
        }
        yield* this.#value(statement.value);
        return;
      }
    }
  }

  /** A loop body; a `case` in it still belongs to the `switch` around the loop. */
  *#loopBody(body: Statement): Gen<void> {
    this.#loops++;
    yield* this.#statement(body);
    this.#loops--;
  }

  // Expressions.

  /** An expression whose value is used: it must be an `int`. */
  *#value(expression: Expression): Gen<void> {
    const type = yield* this.#expression(expression);
    if (type === 'void') throw error('type.void_value', expression.range);
  }

  *#expression(expression: Expression): Gen<ValueType> {
    switch (expression.kind) {
      case 'constant':
        yield* this.#visit(expression.range);
        return 'int';
      case 'string':
        // Anywhere but as a library function's argument, a string literal is an array (0.3).
        throw unsupported('array', expression.range);
      case 'name': {
        yield* this.#visit(expression.range);
        const symbol = this.#lookup(expression.name, expression.range);
        // A function's name used as a value is a pointer to it (0.10).
        if (symbol.kind === 'function') throw unsupported('function_pointer', expression.range);
        this.#symbols.set(expression, symbol);
        return 'int';
      }
      case 'unary':
        yield* this.#visit(expression.range);
        yield* this.#value(expression.operand);
        return 'int';
      case 'increment':
        yield* this.#visit(expression.range);
        yield* this.#lvalue(expression.operand);
        return 'int';
      case 'binary':
        yield* this.#visit(expression.range);
        if (expression.operator === ',') {
          yield* this.#expression(expression.left);
          return yield* this.#expression(expression.right);
        }
        yield* this.#value(expression.left);
        yield* this.#value(expression.right);
        return 'int';
      case 'assign':
        yield* this.#visit(expression.range);
        yield* this.#lvalue(expression.target);
        yield* this.#value(expression.value);
        return 'int';
      case 'conditional': {
        yield* this.#visit(expression.range);
        yield* this.#value(expression.test);
        const consequent = yield* this.#expression(expression.consequent);
        const alternative = yield* this.#expression(expression.alternative);
        if (consequent === 'void' && alternative === 'void') return 'void';
        if (consequent === 'void') throw error('type.void_value', expression.consequent.range);
        if (alternative === 'void') throw error('type.void_value', expression.alternative.range);
        return 'int';
      }
      case 'call':
        return yield* this.#call(expression);
    }
  }

  /** A modifiable lvalue: in 0.1, a variable's name. */
  *#lvalue(expression: Expression): Gen<void> {
    if (expression.kind !== 'name') {
      yield* this.#expression(expression);
      throw error('type.not_assignable', expression.range);
    }
    yield* this.#visit(expression.range);
    const symbol = this.#lookup(expression.name, expression.range);
    if (symbol.kind !== 'variable') throw error('type.not_assignable', expression.range);
    this.#symbols.set(expression, symbol);
  }

  *#call(call: Expression & { kind: 'call' }): Gen<ValueType> {
    yield* this.#visit(call.range);
    const { callee } = call;
    if (callee.kind !== 'name') {
      yield* this.#expression(callee);
      throw error('type.not_callable', callee.range);
    }
    yield* this.#visit(callee.range);
    const symbol = this.#lookup(callee.name, callee.range, true);
    if (symbol.kind !== 'function') throw error('type.not_callable', callee.range);
    this.#symbols.set(callee, symbol);
    if (!this.#called.has(symbol)) this.#called.set(symbol, callee.range);
    const { params, variadic } = symbol.type;
    for (const [i, arg] of call.args.entries()) {
      if (i >= params.length && !variadic) {
        throw error('type.too_many_arguments', arg.range, { function: symbol.name });
      }
      yield* this.#argument(arg, params[i], symbol, i + 1);
    }
    if (call.args.length < params.length) {
      throw error('type.too_few_arguments', call.range, { function: symbol.name });
    }
    return symbol.type.returns;
  }

  /**
   * One argument; `param` is undefined past a variadic function's parameters. A string literal
   * is accepted only as a library function's argument (design/language.md#supported-by-phase).
   */
  *#argument(
    arg: Expression,
    param: LibraryParameter | undefined,
    fn: FunctionSymbol,
    position: number,
  ): Gen<void> {
    const mismatch = () => error('type.argument_type', arg.range, { function: fn.name, position });
    if (arg.kind === 'string') {
      if (fn.library === undefined) throw unsupported('array', arg.range);
      if (param === 'int') throw mismatch();
      yield* this.#visit(arg.range);
      this.#staticData += arg.bytes.length + 1;
      return;
    }
    yield* this.#value(arg);
    if (param === 'string') {
      // `0` is a null pointer constant there: a pointer, a construct of 0.3.
      if (arg.kind === 'constant' && arg.value === 0) throw unsupported('pointer', arg.range);
      throw mismatch();
    }
  }
}

/**
 * An integer constant expression's value, as C17 6.6 has it for `int`. The expression has been
 * checked already; this only computes it, so it charges no steps.
 */
function constantValue(expression: Expression): number {
  const notConstant = () => error('type.not_constant', expression.range);
  const checked = (value: number): number => {
    if (value < INT_MIN || value > INT_MAX) {
      throw error('type.constant_overflow', expression.range);
    }
    return value === 0 ? 0 : value;
  };
  switch (expression.kind) {
    case 'constant':
      return expression.value;
    case 'unary': {
      const value = constantValue(expression.operand);
      if (expression.operator === '!') return value === 0 ? 1 : 0;
      return expression.operator === '-' ? checked(-value) : value;
    }
    case 'conditional':
      return constantValue(expression.test) !== 0
        ? constantValue(expression.consequent)
        : constantValue(expression.alternative);
    case 'binary': {
      const { operator } = expression;
      if (operator === ',') throw notConstant();
      const left = constantValue(expression.left);
      if (operator === '&&' && left === 0) return 0;
      if (operator === '||' && left !== 0) return 1;
      const right = constantValue(expression.right);
      switch (operator) {
        case '&&':
        case '||':
          return right !== 0 ? 1 : 0;
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
        case '+':
          return checked(left + right);
        case '-':
          return checked(left - right);
        case '*':
          return checked(Number(BigInt(left) * BigInt(right)));
        case '/':
        case '%': {
          if (right === 0) throw notConstant();
          // The quotient is checked for `%` too: INT_MIN % -1 overflows as INT_MIN / -1 does.
          const quotient = checked(Math.trunc(left / right));
          return operator === '/' ? quotient : checked(left % right);
        }
      }
      throw notConstant();
    }
    default:
      throw notConstant();
  }
}
