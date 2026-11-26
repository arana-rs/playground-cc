// The parser of the C that 0.1 accepts. Every function is a generator, so parsing pauses between
// slices like the run does (design/engine.md#before-the-run). One step per syntax node built.
import type {
  AssignOperator,
  BinaryOperator,
  Block,
  Declaration,
  Declarator,
  Expression,
  FunctionDefinition,
  Include,
  Initializer,
  Parameter,
  Parameters,
  Statement,
  TranslationUnit,
  TypeName,
} from './ast';
import { DiagnosticError, type Range, type SyntaxCode } from './diagnostic';
import type { Steps } from './steps';
import type { Keyword, Token, TokenStream } from './tokens';

type Gen<T> = Generator<void, T, void>;

/** A declarator before it is known to have a name: in a parameter it may not. */
type NamedDeclarator = Omit<Declarator, 'name'> & { name?: string };

/** Keywords that start a declaration: specifiers, qualifiers, storage classes, `_Static_assert`. */
const DECLARATION_KEYWORDS: ReadonlySet<string> = new Set([
  ...['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool'],
  ...['_Complex', '_Imaginary', 'struct', 'union', 'enum', 'typedef', 'extern', 'static', 'auto'],
  ...['register', 'const', 'restrict', 'volatile', '_Atomic', 'inline', '_Noreturn'],
  ...['_Thread_local', '_Alignas', '_Static_assert'],
]);

/** Binary operators by precedence, loosest first; the bitwise ones are a construct of 0.2. */
const PRECEDENCE: ReadonlyMap<string, number> = new Map([
  ['||', 1],
  ['&&', 2],
  ['|', 3],
  ['^', 4],
  ['&', 5],
  ['==', 6],
  ['!=', 6],
  ['<', 7],
  ['>', 7],
  ['<=', 7],
  ['>=', 7],
  ['<<', 8],
  ['>>', 8],
  ['+', 9],
  ['-', 9],
  ['*', 10],
  ['/', 10],
  ['%', 10],
]);
/** GNU extension keywords: in C17 they are reserved identifiers. */
const EXTENSION_NAMES: ReadonlySet<string> = new Set([
  ...['__attribute__', '__attribute', '__typeof__', '__typeof', '__extension__', '__asm__'],
  ...['__asm', '__builtin_va_arg', '__label__', '__auto_type'],
]);
const BITWISE: ReadonlySet<string> = new Set(['|', '^', '&', '<<', '>>']);
const ASSIGN: ReadonlySet<string> = new Set(['=', '+=', '-=', '*=', '/=', '%=']);
const BITWISE_ASSIGN: ReadonlySet<string> = new Set(['&=', '|=', '^=', '<<=', '>>=']);

export function span(first: Range, last: Range): Range {
  return { file: first.file, start: first.start, end: last.end };
}

function syntaxError(code: SyntaxCode, range: Range, args: Record<string, string> = {}) {
  return new DiagnosticError({ code, args, range });
}

function unsupported(construct: string, range: Range): DiagnosticError {
  return new DiagnosticError({ code: 'unsupported.construct', args: { construct }, range });
}

export class Parser {
  /** The step count at which the parser pauses until the next slice. */
  pauseAt = 0;
  readonly #tokens: TokenStream;
  readonly #steps: Steps;
  readonly #nesting: number;
  readonly #buffer: Token[] = [];
  #depth = 0;

  constructor(tokens: TokenStream, steps: Steps, nesting: number) {
    this.#tokens = tokens;
    this.#steps = steps;
    this.#nesting = nesting;
  }

  *parse(): Gen<TranslationUnit> {
    const items: TranslationUnit['items'] = [];
    const first = this.#peek();
    while (this.#peek().kind !== 'eof') {
      const token = this.#peek();
      if (token.kind === 'include') items.push(yield* this.#include());
      else if (this.#startsDeclaration()) items.push(yield* this.#declaration(true));
      else if (token.kind === 'identifier') throw syntaxError('syntax.expected_type', token.range);
      else throw syntaxError('syntax.expected_declaration', token.range);
    }
    return { items, range: span(first.range, this.#peek().range) };
  }

  // Tokens.

  #peek(ahead = 0): Token {
    while (this.#buffer.length <= ahead) {
      const token = this.#tokens.next();
      if (token.kind === 'identifier' && EXTENSION_NAMES.has(token.name))
        throw this.#extension(token);
      this.#buffer.push(token);
    }
    return this.#buffer[ahead] as Token;
  }

  /**
   * A GNU extension keyword, with its parenthesized operand when it has one. It reads ahead
   * without pausing, within the source size limit, and always ends the run.
   */
  #extension(name: Token): DiagnosticError {
    let last = name;
    let next = this.#tokens.next();
    if (next.kind === 'punctuator' && next.punctuator === '(') {
      for (let depth = 0; next.kind !== 'eof'; next = this.#tokens.next()) {
        last = next;
        if (next.kind !== 'punctuator') continue;
        if (next.punctuator === '(') depth++;
        else if (next.punctuator === ')' && --depth === 0) break;
      }
    }
    return unsupported('extension', span(name.range, last.range));
  }

  *#take(): Gen<Token> {
    const token = this.#peek();
    if (token.kind !== 'eof') this.#buffer.shift();
    yield* this.#pause();
    return token;
  }

  *#pause(): Gen<void> {
    if (this.#steps.used >= this.pauseAt) yield;
  }

  #is(punctuator: string, ahead = 0): boolean {
    const token = this.#peek(ahead);
    return token.kind === 'punctuator' && token.punctuator === punctuator;
  }

  #isKeyword(keyword: Keyword, ahead = 0): boolean {
    const token = this.#peek(ahead);
    return token.kind === 'keyword' && token.keyword === keyword;
  }

  #startsDeclaration(ahead = 0): boolean {
    const token = this.#peek(ahead);
    return token.kind === 'keyword' && DECLARATION_KEYWORDS.has(token.keyword);
  }

  *#expect(punctuator: string): Gen<Token> {
    if (!this.#is(punctuator)) {
      throw syntaxError('syntax.expected_token', this.#peek().range, { token: punctuator });
    }
    return yield* this.#take();
  }

  /** Takes a bracketed group from its opening token to the matching closing one. */
  *#skipGroup(): Gen<Token> {
    const open = (yield* this.#take()) as Token & { kind: 'punctuator' };
    const close = open.punctuator === '(' ? ')' : open.punctuator === '[' ? ']' : '}';
    let depth = 1;
    for (;;) {
      const token = this.#peek();
      if (token.kind === 'eof')
        throw syntaxError('syntax.expected_token', token.range, { token: close });
      yield* this.#take();
      if (token.kind !== 'punctuator') continue;
      if (token.punctuator === open.punctuator) depth++;
      else if (token.punctuator === close && --depth === 0) return token;
    }
  }

  /** One step for a syntax node, charged at its range; then the node. */
  *#node<T extends { range: Range }>(node: T): Gen<T> {
    this.#steps.charge(1, node.range);
    yield* this.#pause();
    return node;
  }

  /** One level deeper; past the nesting limit, ends with `limit.nesting`. */
  #enter(range: Range): void {
    if (++this.#depth > this.#nesting) {
      throw new DiagnosticError({ code: 'limit.nesting', args: { limit: this.#nesting }, range });
    }
  }

  #leave(levels = 1): void {
    this.#depth -= levels;
  }

  // Declarations.

  *#include(): Gen<Include> {
    const token = (yield* this.#take()) as Token & { kind: 'include' };
    return yield* this.#node({ kind: 'include', header: token.header, range: token.range });
  }

  /** The declaration specifiers: in 0.1, `int` or `void` alone. */
  *#typeName(): Gen<TypeName> {
    let type: TypeName | undefined;
    while (this.#startsDeclaration()) {
      const token = this.#peek() as Token & { kind: 'keyword' };
      if (token.keyword !== 'int' && token.keyword !== 'void')
        throw yield* this.#keywordConstruct();
      if (type !== undefined) throw syntaxError('syntax.invalid_type_specifiers', token.range);
      yield* this.#take();
      type = { name: token.keyword, range: token.range };
    }
    if (type === undefined) throw syntaxError('syntax.expected_type', this.#peek().range);
    return type;
  }

  /** A keyword construct of a later phase, or not supported at all, keyed by its keyword. */
  *#keywordConstruct(): Gen<DiagnosticError> {
    const token = (yield* this.#take()) as Token & { kind: 'keyword' };
    const keyword = token.keyword;
    if (
      (keyword === 'long' && this.#isKeyword('double')) ||
      (keyword === 'double' && this.#isKeyword('long'))
    ) {
      return unsupported('long_double', span(token.range, (yield* this.#take()).range));
    }
    let last: Token = token;
    if (keyword === 'struct' || keyword === 'union' || keyword === 'enum') {
      if (this.#peek().kind === 'identifier') last = yield* this.#take();
      if (this.#is('{')) last = yield* this.#skipGroup();
    } else if (
      (keyword === '_Static_assert' ||
        keyword === '_Alignas' ||
        keyword === '_Atomic' ||
        keyword === '_Alignof' ||
        keyword === '_Generic') &&
      this.#is('(')
    ) {
      last = yield* this.#skipGroup();
      if (keyword === '_Static_assert' && this.#is(';')) last = yield* this.#take();
    }
    return unsupported(keyword, span(token.range, last.range));
  }

  /**
   * A declaration, or at file scope a function definition. At file scope a variable is a
   * construct of 0.2; in a block, a function definition is a GNU extension.
   */
  *#declaration(fileScope: boolean): Gen<Declaration | FunctionDefinition> {
    const start = this.#peek();
    const type = yield* this.#typeName();
    if (this.#is(';')) {
      throw syntaxError('syntax.empty_declaration', span(start.range, this.#peek().range));
    }
    const declarators: Declarator[] = [];
    for (;;) {
      const declarator = (yield* this.#declarator(false)) as Declarator;
      const [parameters] = declarator.functions;
      if (parameters !== undefined && declarators.length === 0 && this.#is('{')) {
        if (!fileScope || parameters.variadic) {
          const whole = span(start.range, (yield* this.#skipGroup()).range);
          throw unsupported(fileScope ? 'variadic_function' : 'extension', whole);
        }
        const body = yield* this.#block();
        return yield* this.#node({
          kind: 'function',
          type,
          declarator,
          body,
          range: span(start.range, body.range),
        });
      }
      if (this.#is('=')) {
        yield* this.#take();
        declarator.init = yield* this.#initializer();
        declarator.range = span(declarator.range, declarator.init.range);
      }
      declarators.push(yield* this.#node(declarator));
      if (!this.#is(',')) break;
      yield* this.#take();
    }
    const end = yield* this.#expect(';');
    const range = span(start.range, end.range);
    if (fileScope && declarators.some((declarator) => declarator.functions.length === 0)) {
      throw unsupported('global_variable', range);
    }
    return yield* this.#node({ kind: 'declaration', type, declarators, range });
  }

  /**
   * A declarator: a name, maybe in parentheses, then parameter lists. In a parameter it may be
   * abstract (no name). Pointers, arrays and function pointers are constructs of later phases.
   */
  *#declarator(abstract: boolean): Gen<NamedDeclarator> {
    const start = this.#peek();
    this.#enter(start.range);
    if (this.#is('*')) {
      let last = start;
      while (this.#is('*')) last = yield* this.#take();
      if (this.#peek().kind === 'identifier') last = yield* this.#take();
      throw unsupported('pointer', span(start.range, last.range));
    }
    let name: string | undefined;
    let nameRange = start.range;
    let functions: Parameters[] = [];
    let last: Range | undefined;
    if (start.kind === 'identifier') {
      yield* this.#take();
      name = start.name;
      last = start.range;
    } else if (this.#is('(') && this.#is('*', 1)) {
      const group = yield* this.#skipGroup();
      if (!this.#is('(')) throw unsupported('pointer', span(start.range, group.range));
      throw unsupported('function_pointer', span(start.range, (yield* this.#skipGroup()).range));
    } else if (this.#is('(') && (this.#peek(1).kind === 'identifier' || this.#is('(', 1))) {
      yield* this.#take();
      const inner = yield* this.#declarator(abstract);
      ({ name, nameRange, functions } = inner);
      last = (yield* this.#expect(')')).range;
    } else if (!abstract) {
      throw syntaxError('syntax.expected_identifier', start.range);
    }
    let levels = 1;
    for (;;) {
      if (this.#is('[')) {
        const open = this.#peek();
        throw unsupported('array', span(open.range, (yield* this.#skipGroup()).range));
      }
      if (!this.#is('(')) break;
      this.#enter(this.#peek().range);
      levels++;
      const parameters = yield* this.#parameters();
      functions.push(parameters);
      last = parameters.range;
    }
    this.#leave(levels);
    return {
      ...(name !== undefined && { name }),
      nameRange,
      functions,
      range: last === undefined ? start.range : span(start.range, last),
    } as NamedDeclarator;
  }

  /** A parameter list. An identifier list is an old-style (K&R) declarator. */
  *#parameters(): Gen<Parameters> {
    const open = yield* this.#take();
    const params: Parameter[] = [];
    let variadic = false;
    if (this.#isKeyword('void') && this.#is(')', 1)) yield* this.#take();
    else if (this.#peek().kind === 'identifier') {
      let close = this.#peek();
      while (!this.#is(')') && this.#peek().kind !== 'eof') close = yield* this.#take();
      if (this.#is(')')) close = yield* this.#take();
      throw unsupported('old_style_definition', span(open.range, close.range));
    } else if (!this.#is(')')) {
      for (;;) {
        if (params.length > 0 && this.#is('...')) {
          yield* this.#take();
          variadic = true;
          break;
        }
        params.push(yield* this.#parameter());
        if (!this.#is(',')) break;
        yield* this.#take();
      }
    }
    const close = yield* this.#expect(')');
    return yield* this.#node({ params, variadic, range: span(open.range, close.range) });
  }

  *#parameter(): Gen<Parameter> {
    const start = this.#peek();
    const type = yield* this.#typeName();
    const declarator = yield* this.#declarator(true);
    if (declarator.functions.length > 0)
      throw unsupported('function_pointer', span(start.range, declarator.range));
    const range = declarator.name === undefined ? type.range : span(start.range, declarator.range);
    return yield* this.#node({
      type,
      ...(declarator.name !== undefined && { name: declarator.name }),
      range,
    });
  }

  /** An initializer: an expression, or a braced list (designators are a construct of 0.5). */
  *#initializer(): Gen<Initializer> {
    if (!this.#is('{')) return yield* this.#assignment();
    const open = this.#peek();
    this.#enter(open.range);
    yield* this.#take();
    const items: Initializer[] = [];
    while (!this.#is('}')) {
      if (this.#is('.') || this.#is('[')) {
        const start = this.#peek();
        let last = start;
        while (!this.#is('=') && !this.#is('}') && this.#peek().kind !== 'eof')
          last = yield* this.#take();
        throw unsupported('designated_initializer', span(start.range, last.range));
      }
      items.push(yield* this.#initializer());
      if (!this.#is(',')) break;
      yield* this.#take();
    }
    if (items.length === 0) throw syntaxError('syntax.expected_expression', this.#peek().range);
    const close = yield* this.#expect('}');
    this.#leave();
    return yield* this.#node({ kind: 'list', items, range: span(open.range, close.range) });
  }

  // Statements.

  *#block(): Gen<Block> {
    const open = yield* this.#expect('{');
    this.#enter(open.range);
    const items: Block['items'] = [];
    while (!this.#is('}')) {
      const token = this.#peek();
      if (token.kind === 'eof')
        throw syntaxError('syntax.expected_token', token.range, { token: '}' });
      if (token.kind === 'include') items.push(yield* this.#include());
      else if (this.#startsDeclaration()) {
        items.push((yield* this.#declaration(false)) as Declaration);
      } else items.push(yield* this.#statement());
    }
    const close = yield* this.#take();
    this.#leave();
    return yield* this.#node({ kind: 'block', items, range: span(open.range, close.range) });
  }

  *#statement(): Gen<Statement> {
    const start = this.#peek();
    if (this.#is('{')) return yield* this.#block();
    this.#enter(start.range);
    const statement = yield* this.#statementBody(start);
    this.#leave();
    return yield* this.#node(statement);
  }

  *#statementBody(start: Token): Gen<Statement> {
    if (start.kind === 'punctuator' && start.punctuator === ';') {
      yield* this.#take();
      return { kind: 'empty', range: start.range };
    }
    if (start.kind === 'identifier' && this.#is(':', 1)) {
      yield* this.#take();
      throw unsupported('goto', span(start.range, (yield* this.#take()).range));
    }
    if (start.kind !== 'keyword') return yield* this.#expressionStatement(start);
    if (DECLARATION_KEYWORDS.has(start.keyword)) {
      throw syntaxError('syntax.expected_statement', start.range);
    }
    switch (start.keyword) {
      case 'if': {
        yield* this.#take();
        const test = yield* this.#condition();
        const consequent = yield* this.#statement();
        if (!this.#isKeyword('else'))
          return { kind: 'if', test, consequent, range: span(start.range, consequent.range) };
        yield* this.#take();
        const otherwise = yield* this.#statement();
        return {
          kind: 'if',
          test,
          consequent,
          alternative: otherwise,
          range: span(start.range, otherwise.range),
        };
      }
      case 'while': {
        yield* this.#take();
        const test = yield* this.#condition();
        const body = yield* this.#statement();
        return { kind: 'while', test, body, range: span(start.range, body.range) };
      }
      case 'do': {
        yield* this.#take();
        const body = yield* this.#statement();
        if (!this.#isKeyword('while')) {
          throw syntaxError('syntax.expected_token', this.#peek().range, { token: 'while' });
        }
        yield* this.#take();
        const test = yield* this.#condition();
        const end = yield* this.#expect(';');
        return { kind: 'do', body, test, range: span(start.range, end.range) };
      }
      case 'for':
        return yield* this.#for(start);
      case 'switch': {
        yield* this.#take();
        const test = yield* this.#condition();
        const body = yield* this.#statement();
        return { kind: 'switch', test, body, range: span(start.range, body.range) };
      }
      case 'case': {
        yield* this.#take();
        const value = yield* this.#conditional();
        if (this.#is('...')) {
          while (!this.#is(':') && this.#peek().kind !== 'eof') yield* this.#take();
          throw unsupported('extension', span(start.range, this.#peek().range));
        }
        yield* this.#expect(':');
        const body = yield* this.#statement();
        return { kind: 'case', value, body, range: span(start.range, body.range) };
      }
      case 'default': {
        yield* this.#take();
        yield* this.#expect(':');
        const body = yield* this.#statement();
        return { kind: 'default', body, range: span(start.range, body.range) };
      }
      case 'break':
      case 'continue': {
        yield* this.#take();
        const end = yield* this.#expect(';');
        return { kind: start.keyword, range: span(start.range, end.range) };
      }
      case 'return': {
        yield* this.#take();
        if (this.#is(';'))
          return { kind: 'return', range: span(start.range, (yield* this.#take()).range) };
        const value = yield* this.#expression();
        const end = yield* this.#expect(';');
        return { kind: 'return', value, range: span(start.range, end.range) };
      }
      case 'goto': {
        yield* this.#take();
        let last: Token = start;
        if (this.#peek().kind === 'identifier') last = yield* this.#take();
        if (this.#is(';')) last = yield* this.#take();
        throw unsupported('goto', span(start.range, last.range));
      }
      default:
        return yield* this.#expressionStatement(start);
    }
  }

  *#expressionStatement(start: Token): Gen<Statement> {
    const expression = yield* this.#expression();
    const end = yield* this.#expect(';');
    return { kind: 'expression', expression, range: span(start.range, end.range) };
  }

  /** A parenthesized controlling expression. */
  *#condition(): Gen<Expression> {
    yield* this.#expect('(');
    const test = yield* this.#expression();
    yield* this.#expect(')');
    return test;
  }

  *#for(start: Token): Gen<Statement> {
    yield* this.#take();
    yield* this.#expect('(');
    let init: Declaration | Expression | undefined;
    if (this.#startsDeclaration()) init = (yield* this.#declaration(false)) as Declaration;
    else {
      if (!this.#is(';')) init = yield* this.#expression();
      yield* this.#expect(';');
    }
    const test = this.#is(';') ? undefined : yield* this.#expression();
    yield* this.#expect(';');
    const step = this.#is(')') ? undefined : yield* this.#expression();
    yield* this.#expect(')');
    const body = yield* this.#statement();
    return {
      kind: 'for',
      ...(init !== undefined && { init }),
      ...(test !== undefined && { test }),
      ...(step !== undefined && { step }),
      body,
      range: span(start.range, body.range),
    };
  }

  // Expressions.

  /** The comma operator's operands are nested one level each, like the AST they build. */
  *#expression(): Gen<Expression> {
    let left = yield* this.#assignment();
    let levels = 0;
    while (this.#is(',')) {
      this.#enter((yield* this.#take()).range);
      levels++;
      const right = yield* this.#assignment();
      left = yield* this.#node({
        kind: 'binary',
        operator: ',',
        left,
        right,
        range: span(left.range, right.range),
      });
    }
    this.#leave(levels);
    return left;
  }

  *#assignment(): Gen<Expression> {
    const target = yield* this.#conditional();
    const token = this.#peek();
    if (token.kind !== 'punctuator') return target;
    const operator = token.punctuator;
    if (!ASSIGN.has(operator) && !BITWISE_ASSIGN.has(operator)) return target;
    yield* this.#take();
    this.#enter(token.range);
    const value = yield* this.#assignment();
    this.#leave();
    const range = span(target.range, value.range);
    if (BITWISE_ASSIGN.has(operator)) throw unsupported('bitwise_operator', range);
    return yield* this.#node({
      kind: 'assign',
      operator: operator as AssignOperator,
      target,
      value,
      range,
    });
  }

  *#conditional(): Gen<Expression> {
    const test = yield* this.#binary(1);
    if (!this.#is('?')) return test;
    this.#enter((yield* this.#take()).range);
    const consequent = yield* this.#expression();
    yield* this.#expect(':');
    const otherwise = yield* this.#conditional();
    this.#leave();
    return yield* this.#node({
      kind: 'conditional',
      test,
      consequent,
      alternative: otherwise,
      range: span(test.range, otherwise.range),
    });
  }

  /** Binary operators by precedence climbing; each operator applied is one level deeper. */
  *#binary(minimum: number): Gen<Expression> {
    let left = yield* this.#cast();
    let levels = 0;
    for (;;) {
      const token = this.#peek();
      const precedence = token.kind === 'punctuator' ? PRECEDENCE.get(token.punctuator) : undefined;
      if (precedence === undefined || precedence < minimum) break;
      const operator = (token as Token & { kind: 'punctuator' }).punctuator;
      yield* this.#take();
      this.#enter(token.range);
      levels++;
      const right = yield* this.#binary(precedence + 1);
      const range = span(left.range, right.range);
      if (BITWISE.has(operator)) throw unsupported('bitwise_operator', range);
      left = yield* this.#node({
        kind: 'binary',
        operator: operator as BinaryOperator,
        left,
        right,
        range,
      });
    }
    this.#leave(levels);
    return left;
  }

  /** A cast expression: a cast and a compound literal are constructs of later phases. */
  *#cast(): Gen<Expression> {
    if (!this.#is('(') || !this.#startsDeclaration(1)) return yield* this.#unary();
    const open = this.#peek();
    yield* this.#skipGroup();
    if (this.#is('{')) {
      throw unsupported('compound_literal', span(open.range, (yield* this.#skipGroup()).range));
    }
    this.#enter(open.range);
    const operand = yield* this.#cast();
    throw unsupported('cast', span(open.range, operand.range));
  }

  *#unary(): Gen<Expression> {
    const token = this.#peek();
    if (token.kind === 'keyword') {
      if (token.keyword === 'sizeof' || token.keyword === '_Alignof') {
        yield* this.#take();
        let last: Range;
        if (this.#is('(') && this.#startsDeclaration(1)) last = (yield* this.#skipGroup()).range;
        else {
          this.#enter(token.range);
          last = (yield* this.#unary()).range;
        }
        throw unsupported(token.keyword, span(token.range, last));
      }
      if (token.keyword === '_Generic') throw yield* this.#keywordConstruct();
      return yield* this.#postfix();
    }
    if (token.kind !== 'punctuator') return yield* this.#postfix();
    const operator = token.punctuator;
    if (operator === '++' || operator === '--') {
      yield* this.#take();
      this.#enter(token.range);
      const operand = yield* this.#unary();
      this.#leave();
      return yield* this.#node({
        kind: 'increment',
        operator,
        prefix: true,
        operand,
        range: span(token.range, operand.range),
      });
    }
    if (!['+', '-', '!', '~', '&', '*'].includes(operator)) return yield* this.#postfix();
    yield* this.#take();
    this.#enter(token.range);
    const operand = yield* this.#cast();
    this.#leave();
    const range = span(token.range, operand.range);
    if (operator === '~') throw unsupported('bitwise_operator', range);
    if (operator === '&' || operator === '*') throw unsupported('pointer', range);
    return yield* this.#node({
      kind: 'unary',
      operator: operator as '+' | '-' | '!',
      operand,
      range,
    });
  }

  /** Calls and postfix `++` and `--`; subscripts and member access are of later phases. */
  *#postfix(): Gen<Expression> {
    let expression = yield* this.#primary();
    let levels = 0;
    for (;;) {
      const token = this.#peek();
      if (token.kind !== 'punctuator') break;
      if (token.punctuator === '[') {
        throw unsupported('array', span(expression.range, (yield* this.#skipGroup()).range));
      }
      if (token.punctuator === '.' || token.punctuator === '->') {
        let last = yield* this.#take();
        if (this.#peek().kind === 'identifier') last = yield* this.#take();
        throw unsupported('member_access', span(expression.range, last.range));
      }
      if (token.punctuator !== '(' && token.punctuator !== '++' && token.punctuator !== '--') break;
      this.#enter(token.range);
      levels++;
      if (token.punctuator === '(') {
        yield* this.#take();
        const args: Expression[] = [];
        if (!this.#is(')')) {
          for (;;) {
            args.push(yield* this.#assignment());
            if (!this.#is(',')) break;
            yield* this.#take();
          }
        }
        const close = yield* this.#expect(')');
        expression = yield* this.#node({
          kind: 'call',
          callee: expression,
          args,
          range: span(expression.range, close.range),
        });
      } else {
        yield* this.#take();
        expression = yield* this.#node({
          kind: 'increment',
          operator: token.punctuator as '++' | '--',
          prefix: false,
          operand: expression,
          range: span(expression.range, token.range),
        });
      }
    }
    this.#leave(levels);
    return expression;
  }

  *#primary(): Gen<Expression> {
    const token = this.#peek();
    switch (token.kind) {
      case 'identifier':
        yield* this.#take();
        return yield* this.#node({ kind: 'name', name: token.name, range: token.range });
      case 'integer':
      case 'character':
        yield* this.#take();
        return yield* this.#node({ kind: 'constant', value: token.value, range: token.range });
      case 'string':
        yield* this.#take();
        return yield* this.#node({ kind: 'string', bytes: token.bytes, range: token.range });
      case 'punctuator':
        if (token.punctuator === '(') {
          // A cast where only a unary expression may go (`++(int)x`), or a compound literal.
          if (this.#startsDeclaration(1)) {
            yield* this.#skipGroup();
            if (this.#is('{')) {
              throw unsupported(
                'compound_literal',
                span(token.range, (yield* this.#skipGroup()).range),
              );
            }
            throw unsupported('cast', span(token.range, this.#peek().range));
          }
          if (this.#is('{', 1)) {
            throw unsupported('extension', span(token.range, (yield* this.#skipGroup()).range));
          }
          yield* this.#take();
          this.#enter(token.range);
          const inner = yield* this.#expression();
          yield* this.#expect(')');
          this.#leave();
          return inner;
        }
        break;
      default:
        break;
    }
    throw syntaxError('syntax.expected_expression', token.range);
  }
}
