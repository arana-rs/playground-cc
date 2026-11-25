# Roadmap

> Part of the [playground-cc spec](../spec.md). Related: [engine](engine.md), [frontend](frontend.md), [deployment](deployment.md).

| Phase | Meaning |
|---|---|
| **0.1 to 0.6** | Alpha: one release per phase, each a complete flow that ends in its exit tests ([testing](testing.md)). 0.6 is the **MVP**, the first usable release: a learner can write a C program with arrays, pointers, structs and the heap, run it with interactive input, and get a clear diagnostic for anything unsupported or undefined. Unmarked behavior in the fragments is MVP scope |
| **0.7 to 0.11** | Beta: the same rule, up to the first complete release. Committed scope |
| **1.0** | The first complete release: no new features, only closing what the beta left open. The fragments mark everything from 0.7 to 1.0 "(1.0)", or with the phase that builds it, "(0.8, 1.0)" |
| **In the roadmap** | Will be built after 1.0. The architecture must not block it. The fragments mark it "(planned)" |
| **Not on the roadmap** | Ideas that could be reconsidered, but nothing is built for them. The architecture does not account for them |

Every phase keeps the tests of the earlier ones green: a phase is done when its own exit tests and all earlier ones pass.

## Alpha: up to the MVP

**0.1 Walking skeleton**
- Editor, Run button and output console; the engine runs in a Web Worker ([engine](engine.md#execution-model))
- Minimal C: `int`, operators, `if`, `while`, `do`, `for`, `switch`, `break`, `continue`, functions and recursion ([language](language.md#supported-by-phase)); `printf` with `%d` and `%s`, `putchar`, `puts` and `exit` ([libc](libc.md#headers-and-functions))
- Explicit diagnostic for every unsupported construct ([language](language.md#not-supported))
- Undefined behavior detected: division by zero, reading an uninitialized variable, unsequenced modifications (`i = i++`), using the value of a function that ended without `return` ([language](language.md#undefined-behavior))
- Stop, and the step budget (before the run too), stack size, static data size, output limit, source size and nesting depth, with provisional values ([limits](limits.md))
- i18n (`es`, `en`) from the first string; dark and light mode
- Deployment with static-web-server ([deployment](deployment.md))
- Test infrastructure: the oracle and engine tests, a minimal end-to-end smoke suite with Playwright, and CI running every test on each change ([testing](testing.md))
- Exit tests: hello world; a recursive Fibonacci prints what GCC prints; an infinite loop is ended by Stop and by the step budget; an unsupported construct shows its diagnostic; each undefined behavior in the list stops with its diagnostic

**0.2 Types and expressions**
- Every integer type with the LP64 conversions, `char`, `float` and `double`; bitwise operators, `sizeof`, global variables, `static` and `const`
- Every `printf` conversion, with its format checks ([libc](libc.md#printf)); `<stdbool.h>`, `<limits.h>`, `<stdint.h>`, `<stddef.h>` and `<float.h>`
- `#define` constants
- Undefined behavior detected: signed integer overflow, invalid shifts, out-of-range floating-point to integer conversions
- Exit tests: integer promotions and conversions print what GCC prints; each undefined behavior in the list stops with its diagnostic

**0.3 Arrays, pointers and strings**
- Arrays, pointers, pointer arithmetic, strings and `<string.h>`
- Undefined behavior detected: out-of-bounds access, null pointer dereference, invalid pointers, dangling pointers to locals, writing into a string literal or a `const` object ([memory](memory.md#detected-errors)); overlapping copies in `<string.h>` ([libc](libc.md#overlapping-copies))
- Exit tests: string functions print what GCC prints; each undefined behavior in the list stops with its diagnostic

**0.4 Input**
- Interactive `stdin`: `scanf` and `getchar` pause the program until the user sends a line, and the end-of-input action makes reads return `EOF` ([libc](libc.md#input))
- `scanf` format checks (`scanf("%d", n)` without `&`), and `fgets` from `stdin`
- Exit tests: a program asks for a number, waits, and answers; Stop works while it waits for input

**0.5 Structs and the heap**
- `struct`, `union`, `enum` and `typedef`
- `malloc`, `calloc`, `realloc` and `free` ([memory](memory.md#the-stack-and-the-heap), [libc](libc.md#heap))
- Undefined behavior detected: use after free, double free, invalid free; a [leak report](memory.md#leak-report) when the program ends
- Exit tests: a linked list prints what GCC prints; freeing twice stops with its diagnostic; an unfreed block shows in the leak report

**0.6 Local persistence: the MVP**
- The code is saved in the browser and restored on reload
- Exit tests: reloading the page keeps the code

## Beta: up to 1.0

**0.7 Debugger**
- A gdb-style command console over the paused state: `break`, `run`, `next`, `step`, `finish`, `continue`, `print`, `display`, `watch`, `x`, `backtrace`, `info locals` and the rest of the [debugger](debugger.md#commands) commands
- Exit tests: `break` on a line, `run`, `next` through it and `print` a variable as it changes; a breakpoint inside a recursive function stops on each call and `backtrace` shows the calls; a diagnostic pauses the session at its line and `print` still works

**0.8 Memory view**
- A window over the page that steps through the program line by line, forward and back, or plays it at a chosen speed, with the code read-only and static data, the stack and the heap drawn as boxes with their addresses, values and names; optional I/O; a "View memory" link on a run's diagnostic ([memory view](memory-view.md))
- Exit tests: a pointer into the heap points at its block; a freed block shows as freed; stepping back returns to the previous line with the same memory and output; a program that reads input steps with I/O on, and reads `EOF` with it off

**0.9 Multiple files**
- Programs made of several `.c` and `.h` files, with `#include "file.h"`
- Function-like macros and conditional compilation (`#if`, `#ifdef`, `#ifndef`) ([language](language.md#supported-by-phase))
- Exit tests: a program split into two `.c` files and a header prints what GCC prints when built from the same files

**0.10 Standard library**
- `<math.h>`, the rest of `<stdlib.h>` (`qsort`, `bsearch`, conversions, `rand`), `<ctype.h>`, `<time.h>` with a deterministic clock, and `<assert.h>` ([libc](libc.md#headers-and-functions))
- Function pointers ([language](language.md#supported-by-phase))
- Exit tests: each new function prints what GCC prints in the oracle tests, except `time` and `clock`, which give deterministic values (`time` 0, `clock` counted in steps)

**0.11 Sharing and offline**
- Sharing a program by URL, and exporting it as files ([sharing](sharing.md))
- Works offline once loaded, with a service worker ([offline](offline.md))
- Exit tests: a shared link opens the same program; a link past a bound is refused with the editor unchanged; an exported program of several files unzips to the same files; the playground runs a program with the network off

**1.0 Close**
- No new features. Every "set by measuring" value of the features up to 1.0 gets its measured value.
- The whole test suite passes, the UI has had its review by hand, and the documentation is complete.

## In the roadmap

After 1.0.

- **Threads**: `pthread` support, with a simple scheduler in the engine that simulates CPU scheduling between threads ([engine](engine.md#execution-model)).
- **C++**: C++ support.
- **Examples**: a set of example programs to open in the editor.
- **Exercises**: exercises to solve in the playground.
- **Import**: opening `.c` files from the computer into the editor, and `.cpp` and `.cc` once C++ arrives ([sharing](sharing.md#import-planned)).
- **Files**: `fopen` and the other file functions over an in-browser file system ([libc](libc.md#headers-and-functions)).
- **Differential fuzzing with Csmith**: random programs free of undefined behavior, generated without what the subset lacks, run through the engine and GCC and compared ([testing](testing.md#differential-fuzzing-planned)).

## Not on the roadmap

Ideas that could be reconsidered; nothing is built for them.

- `goto`, user-defined variadic functions, and the other constructs listed as [not supported](language.md#not-supported).
