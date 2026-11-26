# Diagnostic codes

> Part of the [playground-cc spec](README.md). Related: [engine](engine.md), [architecture](architecture.md), [frontend](frontend.md).

Every diagnostic, with its code. The engine produces them all, except `engine.internal`, which the Worker loop produces when the engine fails, and the UI when the Worker fails to load or crashes. The rule that produces each one lives in the fragment linked from its row; this table is the index. `design/check_links.py` checks that every code written in the spec is listed here, and that every code listed here is used somewhere else.

## Format

- **A diagnostic is data, never text**: `code`, `args`, `range`, and `stack` for those raised during the run; `range` and `stack` are left out when no source location applies, as in `engine.internal`, `limit.source` and `limit.static_data`. The engine never produces message text; the UI turns a diagnostic into a message with the message catalogs ([architecture](architecture.md#components)).
- **Code**: `area.reason`, lower case, the reason in snake case. A code never changes meaning; a new meaning gets a new code.
- **Args**: named values, strings or numbers, that fill the placeholders of the code's message. Identifiers, types and source text go as written in C (`count`, `unsigned long`), never translated; only fixed keys, like `construct`, are translated. A type is written with its `typedef` names, never expanded, as GCC writes it, everywhere a type is shown, except `ptype`, which expands only its outer level ([debugger](debugger.md#commands)). A string arg longer than the text length limit is cut with `…` ([limits](limits.md#run-limits)).
- **Range**: the file name, and the start and end line and column, 1-based. The end is exclusive, so a range where start equals end marks a point (the end of the file, for example). Columns count UTF-16 code units, the unit of JavaScript strings and of the editor.
- **Stack** (during the run only): the call stack when the program stopped, innermost first, each frame with its function name (cut at the text length limit) and range, up to the frames listed limit, plus the total number of frames ([limits](limits.md#run-limits)), so deep recursion shows "N more frames" instead of every one.
- **Every diagnostic is an error**: there are no warnings.
- **Before the run** (preprocessing, parsing, checking): only the first diagnostic found is reported, and the program does not start.
- **During the run**: the diagnostic stops the program between two steps ([engine](engine.md#execution-model)). The output written before it stays in the console, even where a native program would have lost its buffered output.
- **Translation**: each code has one message in each catalog (`es`, `en`), with placeholders named after its args. A code without a message shows a generic message with the code.
- Codes for syntax, name and type errors are added as each check is built ([language](language.md#checks)).

## Codes

| Code | When | Rule |
|---|---|---|
| `unsupported.construct` | Before the run: a C construct the engine does not support; carries `construct`, a fixed key the catalogs translate (`goto`, `vla`), and its range covers the whole construct. Also answers a construct whose phase has not been released yet | [language](language.md#not-supported) |
| `unsupported.function` | Before the run: the program uses a C17 standard library function outside the subset; carries `name` | [libc](libc.md#headers-and-functions) |
| `unsupported.header` | Before the run: a standard header outside the subset, or any other system header; carries `header` | [libc](libc.md#headers-and-functions) |
| `directive.error` | Before the run: an `#error` directive; carries `message`, its tokens as written | [language](language.md#supported-by-phase) |
| `limit.steps` | During or before the run: the program, or the steps before it, used up the step budget; carries `limit`, the budget | [engine](engine.md#execution-model) |
| `ub.division_by_zero` | During the run: integer division or remainder by zero | [language](language.md#undefined-behavior) |
| `ub.uninitialized_read` | During the run: reading a value with bytes never written; carries `name` for a variable | [memory](memory.md#blocks) |
| `ub.unsequenced` | During the run: an object modified twice, or modified and read, without sequencing; carries `name` | [language](language.md#undefined-behavior) |
| `ub.missing_return` | During the run: the value of a non-`void` function that ended without `return` is used; carries `function` | [language](language.md#undefined-behavior) |
| `ub.signed_overflow` | During the run: signed integer overflow; carries `type` | [language](language.md#undefined-behavior) |
| `ub.invalid_shift` | During the run: a shift count out of range, or a left shift of a negative value or past the type; carries `type` | [language](language.md#undefined-behavior) |
| `ub.float_conversion` | During the run: a floating-point value that does not fit the integer type it is converted to; carries `type` | [language](language.md#undefined-behavior) |
| `ub.out_of_bounds` | During the run: an access or pointer arithmetic outside its block; carries `size`, `offset`, and `name` for a variable | [memory](memory.md#detected-errors) |
| `ub.null_dereference` | During the run: dereferencing a null pointer, or arithmetic on it other than adding 0 | [memory](memory.md#detected-errors) |
| `ub.invalid_pointer` | During the run: using a pointer with no block | [memory](memory.md#detected-errors) |
| `ub.dangling_pointer` | During the run: using a pointer to a local whose scope has ended; carries `name` | [memory](memory.md#detected-errors) |
| `ub.string_literal_write` | During the run: writing into a string literal | [memory](memory.md#detected-errors) |
| `ub.const_write` | During the run: writing into an object defined `const`; carries `name` | [memory](memory.md#detected-errors) |
| `ub.use_after_free` | During the run: using a pointer to a freed heap block (0.5) | [memory](memory.md#detected-errors) |
| `ub.double_free` | During the run: freeing a heap block twice (0.5) | [memory](memory.md#detected-errors) |
| `ub.invalid_free` | During the run: freeing a pointer that is not the start of a live heap block (0.5) | [memory](memory.md#detected-errors) |
| `ub.overlapping_copy` | During the run: a `<string.h>` copy whose source and destination overlap; carries `function` | [libc](libc.md#overlapping-copies) |
| `ub.format_mismatch` | During the run: a `printf` or `scanf` argument that does not match its conversion; carries `conversion` and `type` | [libc](libc.md#printf) |
| `ub.format_missing_argument` | During the run: fewer `printf` or `scanf` arguments than conversions; carries `conversion` | [libc](libc.md#printf) |
| `ub.format_invalid` | During the run: a malformed conversion in a format; carries `conversion` | [libc](libc.md#printf) |
| `unsupported.conversion` | During the run: a valid C17 `printf` or `scanf` conversion outside the subset (`%n`, `%Lf`); carries `conversion` | [libc](libc.md#printf) |
| `assert.failed` | During the run: a failed `assert` (1.0); carries `expression` | [libc](libc.md#assert) |
| `limit.output` | During the run: a write that would take the program's output past its size limit; carries `limit`, the limit in bytes | [engine](engine.md#execution-model) |
| `limit.source` | Before the run: the source, all files together, is larger than its limit; carries `limit` | [limits](limits.md#run-limits) |
| `limit.include_depth` | Before the run: `#include`s nested deeper than the limit (1.0); carries `limit` | [limits](limits.md#run-limits) |
| `limit.nesting` | Before the run: expressions, statements, declarators or a resolved type nested deeper than the limit; carries `limit` | [engine](engine.md#before-the-run) |
| `limit.static_data` | Before the run: globals, `static` variables and string literals together larger than the limit; carries `limit` | [memory](memory.md#the-stack-and-the-heap) |
| `limit.stack` | During the run: a call that does not fit in the stack | [memory](memory.md#the-stack-and-the-heap) |
| `engine.internal` | An unexpected failure inside the engine (a bug in the engine, never in the user's program), or a Worker that fails to load or crashes | [architecture](architecture.md#components), [worker protocol](worker-protocol.md#worker-to-ui) |

## Endings without a code

- The program ends on its own: `main` returns or `exit` is called. The UI shows the exit status.
- The user presses Stop ([architecture](architecture.md#components)).
- Reports shown after the program ends, like the [leak report](memory.md#leak-report) (0.5), are not diagnostics: they do not stop anything.
