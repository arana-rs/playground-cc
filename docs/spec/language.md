# C language

> Part of the [playground-cc spec](../spec.md). Related: [errors](errors.md), [engine](engine.md), [roadmap](roadmap.md).

The C the engine accepts: the standard, the target platform, what is supported in each phase and what is not supported at all. The standard library subset is a separate topic.

## Standard and target

- **Standard**: C17 (ISO/IEC 9899:2018), with no GNU or other extensions.
- **Target**: x86-64 Linux with the System V ABI (LP64). Every implementation-defined behavior is what GCC does there; the oracle tests run on that platform.
- **Constraint violations are errors**: whatever C17 requires a diagnostic for stops the program before it starts, even where GCC only warns (calling an undeclared function, for example). Those codes (areas `syntax`, `name`, `type`) are added to [errors](errors.md) as each check is built.
- **Order of evaluation**: where C17 leaves it unspecified (operands, function arguments), the engine evaluates left to right. A program whose output depends on that order is outside the GCC and Clang guarantee ([principles](../spec.md#principles)).
- **Character set**: source and execution character set are UTF-8, as in GCC; a non-ASCII character in a string literal takes its UTF-8 bytes.
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
| 0.1 | Every C17 lexical element (comments, constants, escapes, trigraphs, digraphs, line splicing); `int` and `void`; functions with parameters and return values, recursion; local variables and block scope; arithmetic, comparison, logical, assignment and compound assignment operators, `++`, `--`, `?:` and the comma operator; `if`, `else`, `while`, `do`, `for`, `switch`, `break`, `continue`, `return`; string literals as arguments; `#include` of the supported standard headers |
| 0.2 | Every integer type, `_Bool`, `float`, `double`; casts, integer promotions and the usual arithmetic conversions; bitwise operators and shifts; `sizeof`, `_Alignof`, `_Static_assert`; global variables, `static` and `const`; object-like `#define` |
| 0.3 | Arrays (multidimensional too) and their initializers; pointers, `&`, `*`, pointer arithmetic and comparison, `void *`, pointers to pointers, `NULL`; strings as `char` arrays; the `int main(int argc, char *argv[])` form |
| 0.5 | `struct`, `union`, `enum`, `typedef`; `.` and `->`; structs assigned, passed and returned by value; designated initializers |
| 0.9 (1.0) | Several files: `extern`, file-scope `static`, `#include "file.h"` up to the include depth ([limits](limits.md#run-limits)); function-like macros, `#undef`, `#if`, `#ifdef`, `#ifndef`, `#elif`, `#else`, `#endif`, `defined` |
| 0.10 (1.0) | Function pointers |

- **`main`**: `int main(void)` and `int main()` from 0.1. With the `argc`/`argv` form, `argc` is 1, `argv[0]` is a modifiable `"main"` and `argv[1]` is `NULL`, as C17 requires. Reaching the end of `main` returns 0, as C17 says. The exit status is the value returned by `main` or passed to `exit`, modulo 256, as Linux reports it.
- **Before its phase**: a construct whose phase has not been released yet is reported like an unsupported one, with `unsupported.construct` and its keyword as the key (`struct`, `union`), or a short name when it has none (`array`, `pointer`).

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
| `extension` | GNU extensions (`__attribute__`, statement expressions, `typeof`, case ranges, nested functions, zero-length arrays) |

## Undefined behavior

Each detected undefined behavior stops the program during the run with its code ([errors](errors.md)). Undefined behavior of memory and pointers is in [memory](memory.md#detected-errors).

| Phase | Undefined behavior | Code |
|---|---|---|
| 0.1 | Integer division or remainder by zero | `ub.division_by_zero` |
| 0.1 | Reading a value with bytes never written ([memory](memory.md#blocks)); carries `name` for a variable | `ub.uninitialized_read` |
| 0.1 | Two unsequenced modifications of the same object, or a modification and an unsequenced read of it (`i = i++`, `a[i] = i++`); carries `name`. Detected even though the engine evaluates left to right | `ub.unsequenced` |
| 0.1 | Using the value of a call to a non-`void` function that ended without `return` (`main` excepted); carries `function` | `ub.missing_return` |
| 0.2 | Signed integer overflow, `INT_MIN / -1` included; carries `type` | `ub.signed_overflow` |
| 0.2 | A shift by a negative count or by at least the width of the promoted left operand, or a left shift of a negative value or whose result does not fit; carries `type` | `ub.invalid_shift` |
| 0.2 | Converting a floating-point value to an integer type that cannot hold its integer part, NaN and infinities included; carries `type` | `ub.float_conversion` |
