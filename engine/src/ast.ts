// The syntax tree of the C that 0.1 accepts (design/language.md#supported-by-phase).
import type { Range } from './diagnostic';

export type BinaryOperator =
  | ','
  | '||'
  | '&&'
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | '+'
  | '-'
  | '*'
  | '/'
  | '%';

export type AssignOperator = '=' | '+=' | '-=' | '*=' | '/=' | '%=';

export type Expression =
  /** An integer or character constant: both are `int` in 0.1. */
  | { kind: 'constant'; value: number; range: Range }
  /** The bytes of a string literal, without the terminating NUL. */
  | { kind: 'string'; bytes: Uint8Array; range: Range }
  | { kind: 'name'; name: string; range: Range }
  | { kind: 'unary'; operator: '+' | '-' | '!'; operand: Expression; range: Range }
  | { kind: 'increment'; operator: '++' | '--'; prefix: boolean; operand: Expression; range: Range }
  | { kind: 'binary'; operator: BinaryOperator; left: Expression; right: Expression; range: Range }
  | {
      kind: 'assign';
      operator: AssignOperator;
      target: Expression;
      value: Expression;
      range: Range;
    }
  | {
      kind: 'conditional';
      test: Expression;
      consequent: Expression;
      alternative: Expression;
      range: Range;
    }
  | { kind: 'call'; callee: Expression; args: Expression[]; range: Range };

export type Initializer = Expression | { kind: 'list'; items: Initializer[]; range: Range };

export interface TypeName {
  name: 'int' | 'void';
  range: Range;
}

/** A function declarator's parameter list; `()` and `(void)` both have no parameters. */
export interface Parameters {
  params: Parameter[];
  /** Ends with `...`. */
  variadic: boolean;
  range: Range;
}

export interface Parameter {
  type: TypeName;
  name?: string;
  range: Range;
}

export interface Declarator {
  name: string;
  nameRange: Range;
  /** Its function parameter lists, innermost first: more than one is a function returning one. */
  functions: Parameters[];
  init?: Initializer;
  range: Range;
}

export interface Declaration {
  kind: 'declaration';
  type: TypeName;
  declarators: Declarator[];
  range: Range;
}

/** An `#include` of a supported standard header: its declarations start here. */
export interface Include {
  kind: 'include';
  header: string;
  range: Range;
}

export interface FunctionDefinition {
  kind: 'function';
  type: TypeName;
  declarator: Declarator;
  body: Block;
  range: Range;
}

export interface Block {
  kind: 'block';
  items: (Statement | Declaration | Include)[];
  range: Range;
}

export type Statement =
  | Block
  | { kind: 'expression'; expression: Expression; range: Range }
  | { kind: 'empty'; range: Range }
  | { kind: 'if'; test: Expression; consequent: Statement; alternative?: Statement; range: Range }
  | { kind: 'while'; test: Expression; body: Statement; range: Range }
  | { kind: 'do'; body: Statement; test: Expression; range: Range }
  | {
      kind: 'for';
      init?: Declaration | Expression;
      test?: Expression;
      step?: Expression;
      body: Statement;
      range: Range;
    }
  | { kind: 'switch'; test: Expression; body: Statement; range: Range }
  /** `label` is the range of `case value:` alone, without the statement after it. */
  | { kind: 'case'; value: Expression; body: Statement; label: Range; range: Range }
  | { kind: 'default'; body: Statement; label: Range; range: Range }
  | { kind: 'break'; range: Range }
  | { kind: 'continue'; range: Range }
  | { kind: 'return'; value?: Expression; range: Range };

export interface TranslationUnit {
  items: (FunctionDefinition | Declaration | Include)[];
  range: Range;
}
