// A diagnostic is data, never text: the UI turns it into a message (design/errors.md#format).

/** The syntax errors; each one has its row in design/language.md#checks. */
export type SyntaxCode =
  | 'syntax.unterminated_comment'
  | 'syntax.unterminated_char'
  | 'syntax.unterminated_string'
  | 'syntax.stray_character'
  | 'syntax.invalid_identifier_character'
  | 'syntax.invalid_ucn'
  | 'syntax.invalid_escape'
  | 'syntax.escape_out_of_range'
  | 'syntax.empty_char_constant'
  | 'syntax.invalid_number'
  | 'syntax.constant_too_large'
  | 'syntax.invalid_directive'
  | 'syntax.invalid_include'
  | 'syntax.extra_tokens'
  | 'syntax.directive_whitespace'
  | 'syntax.expected_token'
  | 'syntax.expected_expression'
  | 'syntax.expected_identifier'
  | 'syntax.expected_type'
  | 'syntax.expected_declaration'
  | 'syntax.expected_statement'
  | 'syntax.invalid_type_specifiers'
  | 'syntax.empty_declaration'
  | 'syntax.break_outside_loop'
  | 'syntax.continue_outside_loop'
  | 'syntax.case_outside_switch'
  | 'syntax.duplicate_default'
  | 'syntax.for_declaration';

/** The name and type errors; each one has its row in design/language.md#checks. */
export type CheckCode =
  | 'name.undeclared'
  | 'name.redefined'
  | 'name.unnamed_parameter'
  | 'name.undefined_function'
  | 'name.missing_main'
  | 'type.void_object'
  | 'type.void_value'
  | 'type.not_assignable'
  | 'type.not_callable'
  | 'type.too_few_arguments'
  | 'type.too_many_arguments'
  | 'type.argument_type'
  | 'type.return_value_in_void'
  | 'type.missing_return_value'
  | 'type.conflicting_types'
  | 'type.invalid_void_parameter'
  | 'type.function_returning_function'
  | 'type.invalid_initializer'
  | 'type.invalid_main'
  | 'type.not_constant'
  | 'type.constant_overflow'
  | 'type.duplicate_case';

/** Every diagnostic code in use so far; each one has its row in design/errors.md. */
export type DiagnosticCode =
  | SyntaxCode
  | CheckCode
  | 'unsupported.function'
  | 'limit.static_data'
  | 'limit.stack'
  | 'unsupported.construct'
  | 'unsupported.header'
  | 'directive.error'
  | 'engine.internal'
  | 'limit.source'
  | 'limit.steps'
  | 'limit.nesting';

/** A place in a file: 1-based line and column, the column in UTF-16 code units. */
export interface Position {
  line: number;
  column: number;
}

/** A span of a file; `end` is exclusive, so `start` equal to `end` marks a point. */
export interface Range {
  file: string;
  start: Position;
  end: Position;
}

export interface Frame {
  function: string;
  range: Range;
}

/** The call stack when the program stopped, innermost frame first. */
export interface Stack {
  frames: Frame[];
  /** Every frame on the stack, including those past the frames listed limit. */
  total: number;
}

export interface Diagnostic {
  code: DiagnosticCode;
  args: Record<string, string | number>;
  /** Left out when no source location applies. */
  range?: Range;
  /** Only for diagnostics raised during the run. */
  stack?: Stack;
}

/** Thrown inside the engine to end the run with a diagnostic; any other exception is an engine bug. */
export class DiagnosticError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.code);
    this.name = 'DiagnosticError';
  }
}
