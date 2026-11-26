# Memory model

> Part of the [playground-cc spec](README.md). Related: [language](language.md), [memory view](memory-view.md), [errors](errors.md), [engine](engine.md), [roadmap](roadmap.md).

How the engine represents memory, what a pointer is, and which memory errors it detects. Unmarked phases are MVP ([roadmap](roadmap.md)).

## Blocks

- **Every object is a block**: each variable, each heap allocation and each string literal is a separate block with its own bytes, little-endian, laid out as in [language](language.md#types).
- A block knows its size, its kind (local, global, string literal, heap), whether it is read-only (string literals and objects defined `const`), its name when it is a variable, where it was created (the declaration, or the allocation call) and whether it is still alive. A local's block dies when its scope ends; a heap block dies when it is freed. A dead block drops its bytes and keeps only what the errors below and the [memory view](memory-view.md#what-it-shows) need (its address, size, kind, name and where it was created); the rest is collected once no pointer refers to it, so many allocations over a run do not grow memory.
- **Bounds are per block**: an array inside a struct, or one row of a multidimensional array, is not checked on its own. `s.a[2]` running into `s.b`, or `m[0][3]` into `m[1][0]`, stays inside the block and is not detected.
- **Initialization is tracked per byte.** Globals and `static` variables start as zeros; locals and `malloc` memory start unwritten. Reading a value with any unwritten byte stops the program with `ub.uninitialized_read`, with one exception that C17 allows: a byte read through `unsigned char` may be copied (assigned or stored) and the copy stays unwritten, but any other use of it (arithmetic, comparison, output, conversion) stops the program. Struct assignment, `memcpy` and `memmove` copy that state without reading, so copying a struct with padding is not an error.
- Each written byte also remembers the scalar type of the store that wrote it and its position in that value, and copies carry it along with the rest of the byte's state; bytes `calloc` zeroes are written with no type. This is how the [memory view](memory-view.md#drawing) (0.8, 1.0) draws heap blocks, which have no type of their own.

## Pointers

- **A pointer is a block and an offset** (0.3). Every access checks them against the block, which is how the memory errors below are found.
- **Addresses are deterministic**: each block also gets a numeric address, from fixed x86-64-like bases (static data low, the heap above it, the stack near the top of user space, growing down). Within a frame, parameters and then locals get ascending addresses in declaration order. The same program gets the same addresses on every run. Heap addresses are never reused; when the heap's address range is used up, an allocation returns `NULL`, as when the heap is full. Native programs get different addresses on every run, so the oracle tests never print one.
- **A pointer stored in memory keeps its block byte by byte**: each of its 8 bytes remembers the block and its position in the pointer, and copying the bytes in any way (`memcpy`, a loop over `unsigned char`) copies that too. Reading 8 bytes that are the 8 bytes of one pointer, in order, gives that pointer back; any other mix gives a pointer with no block, and using it stops with `ub.invalid_pointer`.
- **Integers and pointers**: converting a pointer to an integer gives its address. Converting an integer to a pointer is not supported (`unsupported.construct` with key `integer_to_pointer`, [language](language.md#not-supported)), except a null pointer constant.
- `NULL` is address 0 with no block.
- **Using a pointer** means dereferencing it, doing arithmetic on it, comparing it with `<`, `<=`, `>`, `>=`, or passing it to `free`. Assigning it, comparing it with `==` or `!=`, and printing it with `%p` are not uses, so `free(p); if (p != NULL)` is not stopped.

## The stack and the heap

- **Sizes never overflow**: the engine computes every object's size, and every total below, in a way that cannot overflow, so a huge object meets its limit instead of wrapping around to a small size.
- **Static data**: globals, `static` variables and string literals have a size in bytes together ([limits](limits.md)). The engine adds them up before the run, before any of them is allocated; past the limit, the program does not start and stops with `limit.static_data`, so `static char big[1L << 40];` is refused, not allocated.
- **Stack**: each call adds a frame with a fixed cost of 16 bytes (the return address and the saved frame pointer, as on x86-64) plus the blocks of its locals. The stack has a size in bytes ([limits](limits.md)); the frame is checked before any of its blocks is allocated, and a call that does not fit stops the program with `limit.stack`, so `void f(void) { f(); }` stops too, and a local `char big[1L << 40];` is never allocated.
- **Heap** (0.5): `malloc` creates a heap block; `malloc(0)` gives a unique non-null pointer to an empty block, as glibc does. The heap has a size counted in live bytes plus a fixed overhead per block, so a loop of `malloc(0)` also runs out (freed blocks give theirs back, [limits](limits.md)); when an allocation does not fit, it returns `NULL`, as C allows, so the program can check for it. `free(NULL)` does nothing. `calloc` and `realloc` follow these rules, plus their own in [libc](libc.md#heap).

## Detected errors

Each one stops the program during the run with its code ([errors](errors.md)).

| Phase | Error | Code |
|---|---|---|
| 0.3 | Access outside the block, or pointer arithmetic that leaves it (one past the end is allowed, but not dereferenced); carries `size` and `offset`, and `name` for a variable | `ub.out_of_bounds` |
| 0.3 | Dereferencing a null pointer, or arithmetic on it other than adding 0 | `ub.null_dereference` |
| 0.3 | Using a pointer with no block (its bytes were partly overwritten or mixed) | `ub.invalid_pointer` |
| 0.3 | Using a pointer to a local whose scope has ended (returning `&local`, for example); carries `name` | `ub.dangling_pointer` |
| 0.3 | Writing into a string literal | `ub.string_literal_write` |
| 0.3 | Writing into an object defined `const`, through a cast; carries `name`. The whole block is read-only, as a string literal's is; a `const` member of a non-`const` struct is not detected | `ub.const_write` |
| 0.5 | Using a pointer to a freed heap block | `ub.use_after_free` |
| 0.5 | Freeing a heap block twice | `ub.double_free` |
| 0.5 | Freeing a pointer that is not the start of a live heap block (a local's address, `p + 1`, a string literal) | `ub.invalid_free` |

**Not detected**: they behave as on x86-64.
- Misaligned accesses and strict-aliasing violations.
- Comparing with `<` or subtracting two pointers into different blocks.
- Running past an inner array that stays inside its block (see [blocks](#blocks)).

## Leak report

- **When** (0.5): the program ends on its own (`main` returns or `exit` is called) with heap blocks not freed. Not after a diagnostic or Stop.
- **What**: each unfreed block with its size and the range of the call that allocated it, up to the entry limit in [limits](limits.md), and the totals of all of them. Every unfreed block counts, even one still reachable from a variable.
- It is not a diagnostic ([errors](errors.md#endings-without-a-code)): it does not change the exit status. Like a diagnostic, it is data the UI translates.
