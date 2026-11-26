# Standard library

> Part of the [playground-cc spec](README.md). Related: [language](language.md), [memory](memory.md), [errors](errors.md), [engine](engine.md), [roadmap](roadmap.md).

The subset of the C17 standard library the engine provides, and how it behaves. Library functions read and write memory through the same checks as the program ([memory](memory.md#detected-errors)), so `strcpy` into a short array stops with `ub.out_of_bounds`, and `strlen` of an unterminated array too. Unmarked phases are MVP ([roadmap](roadmap.md)).

## Headers and functions

| Phase | Header | Contents |
|---|---|---|
| 0.1 | `<stdio.h>` | `printf` (`%d` and `%s`, [printf](#printf)), `putchar`, `puts`, `EOF` |
| 0.1 | `<stdlib.h>` | `exit`, `EXIT_SUCCESS`, `EXIT_FAILURE` |
| 0.2 | `<stdio.h>` | Every `printf` conversion ([printf](#printf)) |
| 0.2 | `<stdbool.h>`, `<limits.h>`, `<stdint.h>`, `<stddef.h>`, `<float.h>` | Their types and macros (`bool`, `INT_MAX`, `int32_t`, `size_t`, `DBL_EPSILON`…); `offsetof` from 0.5 |
| 0.3 | `<string.h>` | `strlen`, `strcpy`, `strncpy`, `strcat`, `strncat`, `strcmp`, `strncmp`, `strchr`, `strrchr`, `strstr`, `memcpy`, `memmove`, `memset`, `memcmp` |
| 0.4 | `<stdio.h>` | `scanf`, `getchar`, `fgets` with `stdin` ([input](#input)) |
| 0.5 | `<stdlib.h>` | `malloc`, `calloc`, `realloc`, `free` ([heap](#heap)) |
| 0.10 (1.0) | `<math.h>` | `sqrt`, `cbrt`, `pow`, `exp`, `exp2`, `log`, `log2`, `log10`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `floor`, `ceil`, `round`, `trunc`, `fabs`, `fmod`, `hypot`, `fmin`, `fmax`, their `float` versions (`sqrtf`…), `isnan`, `isinf`, `NAN`, `INFINITY` ([math](#math)) |
| 0.10 (1.0) | `<stdlib.h>` | `qsort`, `bsearch`, `atoi`, `atol`, `atof`, `strtol`, `strtoul`, `strtod`, `abs`, `labs`, `llabs`, `rand`, `srand`, `RAND_MAX` |
| 0.10 (1.0) | `<ctype.h>` | `isalpha`, `isdigit`, `isalnum`, `isspace`, `isupper`, `islower`, `ispunct`, `isxdigit`, `iscntrl`, `isprint`, `isgraph`, `toupper`, `tolower` |
| 0.10 (1.0) | `<time.h>` | `time`, `clock`, `difftime`, `CLOCKS_PER_SEC` ([determinism](#determinism)) |
| 0.10 (1.0) | `<assert.h>` | `assert`, honoring `NDEBUG` |

- **Outside the subset**, before the run: a C17 standard header the subset does not have yet, or any other system header (`<unistd.h>`, `<pthread.h>`), stops with `unsupported.header`; a call to a C17 standard library function outside the subset stops with `unsupported.function` ([errors](errors.md)), whether or not its header was included: the engine knows every C17 library name, so this comes before the undeclared-function error. A function the program defines is its own, whatever its name. One it only declares is the library's: a subset function declared with its type works without its header, and any other C17 library function stops with `unsupported.function` at its first call.
- **Files** (planned): `fopen` and the other file functions over an in-browser file system. Until then `stdout` is the only output stream and `stdin` the only input stream, read by `scanf`, `getchar` and `fgets`.

## printf

- **Conversions in 0.1**: only `%d` and `%s`, with no flags, width, precision or length modifier. Any other valid C17 conversion, `%%` included, and any of those on `%d` or `%s`, stops with `unsupported.conversion`.
- **Conversions**: from 0.2, every C17 conversion except `%n` and the `L` modifier (no `long double`): `d`, `i`, `u`, `o`, `x`, `X`, `c`, `s`, `p`, `f`, `F`, `e`, `E`, `g`, `G`, `a`, `A` and `%%`, with the flags `-`, `+`, space, `#` and `0`, width and precision (`*` included), and the length modifiers `hh`, `h`, `l`, `ll`, `j`, `z` and `t`.
- **Same bytes as glibc**: floating-point conversions print the exact decimal value of the binary number, rounded half to even, as glibc does. JavaScript's `toFixed` and `toPrecision` round ties up, so they are not used. `%a` prints the normalized form (`0x1.8p+1`). Infinity and NaN print as `inf` and `nan` (with a sign when negative, `-nan` included), uppercase for `F`, `E`, `G` and `A`. `%p` prints `0x` and lowercase hex, and `(nil)` for a null pointer.
- **Width and precision** are checked against the output limit before the conversion is built: a conversion that would take the output past it stops with `limit.output` at once, so `printf("%999999999d", 1)` never builds its text ([engine](engine.md#execution-model)).
- **Format checks** (from 0.1, during the run, when the call executes): an argument whose type does not match its conversion (`printf("%d", "hi")`) stops with `ub.format_mismatch`; fewer arguments than conversions with `ub.format_missing_argument`; a malformed conversion (`%y`) with `ub.format_invalid`. A valid C17 conversion outside the subset (`%n`, `%Lf`) is not undefined behavior: it stops with `unsupported.conversion`. Extra arguments are evaluated and ignored, as C17 allows.

## Input

- **`stdin` is interactive** (0.4): the program pauses when a read needs input that has not arrived ([engine](engine.md#execution-model)). Each line the user sends arrives as its UTF-8 bytes plus `\n`.
- **End of input**: the console has an "end of input" action (also Ctrl+D); once the input already sent has been read, reads return `EOF`, so `while ((c = getchar()) != EOF)` programs end.
- **`fgets`** works only with `stdin` until files arrive: it reads up to a newline (kept) or `n - 1` bytes and adds the terminating null; it returns `NULL` at end of input when nothing was read. A `FILE *` other than `stdin` cannot exist yet.
- **`getchar`** returns each byte as an `unsigned char` value (0 to 255) converted to `int`, or `EOF`.
- **`scanf`**: every C17 conversion except `%n`, `%p` and the `L` modifier (`d`, `i`, `u`, `o`, `x`, `X`, `c`, `s`, `[`, `f`, `F`, `e`, `E`, `g`, `G`, `a`, `A`, `%%`), with width, `*` and the length modifiers; the excluded ones stop with `unsupported.conversion`. It returns the number of items assigned, or `EOF`. A `%s` without a width that overruns its array stops with `ub.out_of_bounds`.
- **Format checks** (0.4), the same as `printf`'s: an argument that is not a pointer to the conversion's type (`scanf("%d", n)` without `&`) stops with `ub.format_mismatch`.

## Overlapping copies

`memcpy`, `strcpy`, `strncpy`, `strcat` and `strncat` with a source and destination that overlap stop with `ub.overlapping_copy` (0.3). `memmove` allows overlap.

## Conversions and overflow

- `abs(INT_MIN)`, `labs(LONG_MIN)` and `llabs(LLONG_MIN)` stop with `ub.signed_overflow` (0.10, 1.0).
- `strtol` and `strtoul` return their type's limit on overflow, and `strtod` returns `HUGE_VAL`, as C17 says; `<errno.h>` is not in the subset, so `ERANGE` cannot be read.

## Heap

The heap rules are in [memory](memory.md#the-stack-and-the-heap); these functions add:
- **`calloc`** gives zeroed memory, and `NULL` when `count * size` overflows or does not fit.
- **`realloc`** always moves the data to a new block and frees the old one, so a pointer kept from before stops with `ub.use_after_free` on every run, not only when glibc would have moved it. `realloc(NULL, n)` is `malloc(n)`, `realloc(NULL, 0)` included (a unique non-null pointer); `realloc(p, 0)` with a non-null `p` frees it and returns `NULL`, as glibc does. A pointer that is not the start of a live heap block stops as `free` would ([memory](memory.md#detected-errors)). When the new size does not fit, it returns `NULL` and the old block stays as it was.

## Math

- `sqrt`, `floor`, `ceil`, `round`, `trunc`, `fabs`, `fmod`, `fmin` and `fmax` have exactly defined results and match glibc bit for bit.
- The transcendental functions (`sin`, `exp`, `pow`…) are a TypeScript port of musl's (MIT), never JavaScript's `Math`, whose accuracy the ECMAScript standard leaves to each browser: so every browser gives the same bits. They can differ from glibc in the last bit; a program whose output depends on that bit is outside the GCC and Clang guarantee, and the oracle tests print them with fewer digits.

## Determinism

The library never reads the real clock or real randomness ([principles](README.md#principles)).
- **`rand`** reproduces glibc's generator, written from its published algorithm rather than ported from glibc's source (the additive feedback generator behind `rand`, `RAND_MAX` 2147483647, seed 1 until `srand`), so a seed gives the same sequence as glibc.
- **`time`** always returns 0, and stores it through its argument when that is not null, so `srand(time(NULL))` always gives the same sequence. **`clock`** returns the steps the program has executed so far, not those before the run ([engine](engine.md#before-the-run)), one step counting as one microsecond (`CLOCKS_PER_SEC` is 1000000, as in glibc). Their output is deterministic instead of matching a native run, so both are outside the GCC and Clang guarantee.
- **`qsort`** is a stable merge sort. Its scratch buffer, the array's size in bytes, is charged to the stack size for the length of the call, though it is not a variable and nothing shows it; when it does not fit, the call stops with `limit.stack` before the buffer is made ([memory](memory.md#the-stack-and-the-heap)). The order of equal elements is unspecified in C17, so a program whose output depends on it is outside the GCC and Clang guarantee.

## assert

A failed `assert` (0.10, 1.0) stops the program with `assert.failed`, carrying `expression`, the expression as written in the source.
