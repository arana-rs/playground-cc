# C language

> Part of the [playground-cc spec](README.md). Related: [errors](errors.md), [engine](engine.md), [libc](libc.md), [memory](memory.md), [roadmap](roadmap.md).

The C the engine accepts: the standard, the target platform, what is supported in each phase and what is not supported at all. The standard library subset is a separate topic.

## Standard and target

- **Standard**: C17 (ISO/IEC 9899:2018), with no GNU or other extensions.
- **Target**: x86-64 Linux with the System V ABI (LP64). Every implementation-defined behavior is what GCC does there; the oracle tests run on that platform.
- **Constraint violations are errors**: whatever C17 requires a diagnostic for stops the program before it starts, even where GCC only warns (calling an undeclared function, for example). Those codes (areas `syntax`, `name`, `type`) are added as each check is built, each with its row in [checks](#checks) and in [errors](errors.md).
- **Order of evaluation**: where C17 leaves it unspecified (operands, function arguments), the engine evaluates left to right. A program whose output depends on that order is outside the GCC and Clang guarantee ([principles](README.md#principles)).
- **Character set**: source and execution character set are UTF-8, as in GCC; a non-ASCII character in a string literal takes its UTF-8 bytes.
- **Line breaks**: `\n` is the only one, the one the editor writes; a `\r` is whitespace, like a tab, so a `\` before `\r\n` splices no line. Diagnostic ranges count lines the same way ([errors](errors.md#format)).
- **Empty parentheses**: `()` in a function declaration or definition means no parameters, like `(void)`; calling such a function with arguments is an error. Old-style (K&R) definitions are not supported.

## Types

| Type | Size (bytes) | Notes |
|---|---|---|
| `char` | 1 | Signed |
| `signed char`, `unsigned char`, `_Bool` | 1 | |
| `short`, `unsigned short` | 2 | |
| `int`, `unsigned int` | 4 | |
| `long`, `unsigned long`, `long long`, `unsigned long long` | 8 | `size_t` is `unsigned long`, `ptrdiff_t` is `long` |
| `float` | 4 | IEEE 754 binary32, computed in float precision (`FLT_EVAL_METHOD` 0) |
| `double` | 8 | IEEE 754 binary64 |
| Pointers | 8 | |

- Alignment and struct layout follow the System V ABI: each scalar aligned to its size, members in order with padding, the size rounded up to the largest member alignment.
- Signed integers are two's complement. Converting an out-of-range integer to a signed integer type wraps modulo 2ⁿ; `>>` on a negative value is arithmetic.
- Floating-point arithmetic follows IEEE 754 as in GCC: dividing a floating-point value by zero gives an infinity or NaN, not undefined behavior.
- An enum type is `unsigned int` when no constant is negative and `int` otherwise, as in GCC.
- `long double` is not supported: its 80-bit format has no JavaScript equivalent.

## Supported, by phase

Unmarked phases are MVP ([roadmap](roadmap.md)).

| Phase | Constructs |
|---|---|
| 0.1 | Every C17 lexical element (comments, constants, escapes, trigraphs, digraphs, line splicing); `int` and `void`; functions with parameters and return values, recursion; local variables and block scope; arithmetic, comparison, logical, assignment and compound assignment operators (the bitwise ones from 0.2), `++`, `--`, `?:` and the comma operator; `if`, `else`, `while`, `do`, `for`, `switch`, `break`, `continue`, `return`; string literals as arguments of library functions; `#include` of the supported standard headers, the null directive and `#error` |
| 0.2 | Every integer type, `_Bool`, `float`, `double`; casts, integer promotions and the usual arithmetic conversions; bitwise operators and shifts; `sizeof`, `_Alignof`, `_Static_assert`; global variables, `static` and `const`; object-like `#define` |
| 0.3 | Arrays (multidimensional too) and their initializers; pointers, `&`, `*`, pointer arithmetic and comparison, `void *`, pointers to pointers, `NULL`; strings as `char` arrays; the `int main(int argc, char *argv[])` form |
| 0.5 | `struct`, `union`, `enum`, `typedef`; `.` and `->`; structs assigned, passed and returned by value; designated initializers |
| 0.9 (1.0) | Several files: `extern`, file-scope `static`, `#include "file.h"` up to the include depth ([limits](limits.md#run-limits)); function-like macros, `#undef`, `#if`, `#ifdef`, `#ifndef`, `#elif`, `#else`, `#endif`, `defined` |
| 0.10 (1.0) | Function pointers |

- **`main`**: `int main(void)` and `int main()` from 0.1. With the `argc`/`argv` form, `argc` is 1, `argv[0]` is a modifiable `"main"` and `argv[1]` is `NULL`, as C17 requires. Reaching the end of `main` returns 0, as C17 says. The exit status is the value returned by `main` or passed to `exit`, modulo 256, as Linux reports it.
- **Constants in 0.1**: a character constant is an `int`, as C17 says. A floating constant, or an integer constant whose type is not `int` (a suffix, or a value too large for `int`), is a construct of 0.2.
- **String literals in 0.1 and 0.2** are accepted only as arguments of a library function (`printf`, `puts`); anywhere else they are an array, a construct of 0.3.
- **Directives**: the null directive (`#` alone) does nothing. `#error` stops before the run with `directive.error`, carrying `message`, its tokens as written (empty when there are none). `#line` is not supported.

### Before its phase

A construct whose phase has not been released yet is reported like an unsupported one, with `unsupported.construct` and its keyword as the key (`char`, `static`, `sizeof`, `struct`, `extern`), or one of these keys when it has none:

| Key | Construct | Phase |
|---|---|---|
| `float_constant` | Floating constants | 0.2 |
| `non_int_constant` | Integer constants whose type is not `int` | 0.2 |
| `cast` | Casts | 0.2 |
| `bitwise_operator` | Bitwise operators and shifts, their compound assignments included | 0.2 |
| `global_variable` | Variables at file scope | 0.2 |
| `define` | Object-like `#define` | 0.2 |
| `array` | Arrays, their initializers, and string literals anywhere but as a library function's argument | 0.3 |
| `pointer` | Pointer declarators, `&`, unary `*` | 0.3 |
| `member_access` | `.` and `->` | 0.5 |
| `designated_initializer` | Designated initializers | 0.5 |
| `local_include` | `#include "file.h"` | 0.9 (1.0) |
| `function_macro` | Function-like macros | 0.9 (1.0) |
| `undef` | `#undef` | 0.9 (1.0) |
| `conditional_directive` | `#if`, `#ifdef`, `#ifndef`, `#elif`, `#else`, `#endif`, `defined` | 0.9 (1.0) |
| `function_pointer` | Function pointers | 0.10 (1.0) |

## Not supported

Each of these stops the program before it starts with `unsupported.construct` ([errors](errors.md)), whose `construct` is the key below: the keyword itself when there is one. None is on the roadmap ([not on the roadmap](roadmap.md#not-on-the-roadmap)).

| Key | Construct |
|---|---|
| `goto` | `goto` and labels |
| `variadic_function` | Defining a function with `...` (calling the library's, like `printf`, is supported) |
| `vla` | Variable length arrays |
| `bit_field` | Bit-fields |
| `long_double` | `long double` (two keywords, so a short name) |
| `_Complex`, `_Imaginary` | Complex types |
| `_Generic` | Generic selection |
| `_Atomic` | Atomic types |
| `_Thread_local` | Thread storage |
| `_Alignas` | Alignment specifier |
| `volatile`, `restrict` | Those qualifiers |
| `register`, `auto` | Those storage classes |
| `inline`, `_Noreturn` | Those function specifiers |
| `compound_literal` | Compound literals |
| `anonymous_member` | Anonymous struct and union members |
| `flexible_array_member` | Flexible array members |
| `old_style_definition` | Old-style (K&R) function definitions |
| `integer_to_pointer` | Converting an integer to a pointer, other than a null pointer constant ([memory](memory.md#pointers)) |
| `wide_char` | Wide and Unicode character constants and strings (`L`, `u`, `U`, `u8` prefixes) |
| `pragma` | Any `#pragma`, `#pragma once` included (header guards with `#ifndef` replace it) |
| `line_directive` | `#line` |
| `extension` | GNU extensions (`__attribute__`, statement expressions, `typeof`, case ranges, nested functions, zero-length arrays) |

## Undefined behavior

Each detected undefined behavior stops the program during the run with its code ([errors](errors.md)). Undefined behavior of memory and pointers is in [memory](memory.md#detected-errors).

| Phase | Undefined behavior | Code |
|---|---|---|
| 0.1 | Integer division or remainder by zero | `ub.division_by_zero` |
| 0.1 | Signed integer overflow, `INT_MIN / -1` included; carries `type` | `ub.signed_overflow` |
| 0.1 | Reading a value with bytes never written ([memory](memory.md#blocks)); carries `name` for a variable | `ub.uninitialized_read` |
| 0.1 | Two unsequenced modifications of the same object, or a modification and an unsequenced read of it (`i = i++`, `a[i] = i++`); carries `name`. Detected even though the engine evaluates left to right | `ub.unsequenced` |
| 0.1 | Using the value of a call to a non-`void` function that ended without `return` (`main` excepted); carries `function` | `ub.missing_return` |
| 0.2 | A shift by a negative count or by at least the width of the promoted left operand, or a left shift of a negative value or whose result does not fit; carries `type` | `ub.invalid_shift` |
| 0.2 | Converting a floating-point value to an integer type that cannot hold its integer part, NaN and infinities included; carries `type` | `ub.float_conversion` |

## Checks

Each check of a constraint violation before the run ([standard and target](#standard-and-target)) gets a row here, in a table of its code and what it checks, when the check is built; each code also has its row in [errors](errors.md).

| Code | Check |
|---|---|
| `syntax.unterminated_comment` | A `/*` comment with no `*/` before the end of the file; the range is the `/*` |
| `syntax.unterminated_char` | A `'` with no closing `'` on its line; the range runs to the end of the line |
| `syntax.unterminated_string` | A `"` with no closing `"` on its line; the range runs to the end of the line |
| `syntax.stray_character` | A character that starts no token (`$`, `@`, `` ` ``, a `\` outside a literal, a character not allowed in identifiers); carries `character` |
| `syntax.invalid_identifier_character` | A universal character name in an identifier outside C17 Annex D.1, or an identifier starting with a character of Annex D.2; carries `character`, as written. UTF-8 characters of Annex D.1 are accepted in identifiers, as GCC does |
| `syntax.invalid_ucn` | A universal character name that is incomplete or names a character C17 6.4.3 forbids (below U+00A0 except `$`, `@` and `` ` ``, a surrogate, past U+10FFFF); carries `ucn` |
| `syntax.invalid_escape` | A backslash in a literal followed by no escape sequence (`\q`, `\x` with no digit); carries `escape` |
| `syntax.escape_out_of_range` | An octal or hex escape whose value does not fit in an `unsigned char`; carries `escape` |
| `syntax.empty_char_constant` | `''` |
| `syntax.invalid_number` | A number that is neither an integer nor a floating constant (`09`, `1x`, `0x`, `1e`, `1lL`); carries `number` |
| `syntax.constant_too_large` | An integer constant no type of its list holds (C17 6.4.4.1); carries `number` |

- **Character constants** get the value GCC gives them: one byte is a signed `char`; several (`'ab'`, a non-ASCII character) make an `int` with each byte shifted in, the last four kept.
