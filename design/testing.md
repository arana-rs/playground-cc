# Testing

> Part of the [playground-cc spec](README.md). Related: [architecture](architecture.md), [language](language.md), [errors](errors.md), [limits](limits.md), [roadmap](roadmap.md), [docs site](docs-site.md).

The kinds of tests, the oracle tests against GCC and Clang, and CI. All of this is MVP: the 0.1 test infrastructure ([roadmap](roadmap.md#alpha-up-to-the-mvp)).

## Kinds of tests

| Kind | Tool | Where | Checks |
|---|---|---|---|
| Unit | Vitest | `engine/`, `web/` | Each part on its own: lexer, parser, checker, interpreter, library (`time` and `clock` included, [libc](libc.md#determinism)), UI components |
| Oracle | Vitest, plus GCC and Clang | `engine/tests/oracle/` | A program prints what GCC and Clang print ([oracle tests](#oracle-tests)) |
| Engine | Vitest | `engine/tests/engine/` | A program ends exactly as expected where no native build can say: a diagnostic, a leak report ([engine tests](#engine-tests)) |
| End-to-end | Playwright, in Chromium | `web/e2e/` | A minimal smoke suite through the real page and Worker ([end-to-end tests](#end-to-end-tests)) |

- **Cases arrive with their phase**: a case is added in the phase that implements what it uses, so every case in the repo passes.
- **A case is one file or one folder**: `name.c`, or from 0.9 (1.0) a folder `name/` with its `.c` and `.h` files ([language](language.md#supported-by-phase)).

## Oracle tests

- **A case** is a program, optionally its input (`name.in`), and the expected result: the bytes written to `stdout` (`name.out`) and the exit status (`name.status`).
- **Expected results come from native builds**, never written by hand. A script builds each program with GCC and with Clang, with `-std=c17 -pedantic-errors -Wall -Wextra -Werror` and `-lm`, at `-O0` and at `-O2`, runs each build with `name.in` as `stdin` and `argv[0]` set to `main` ([language](language.md#supported-by-phase)), and writes the result. All four builds must agree and write nothing to `stderr`, or the case is rejected: a disagreement means the output depends on undefined or unspecified behavior.
- **Proven free of undefined behavior**: two more builds must run without a report, one with `-fsanitize=address,undefined` and one with Clang's `-fsanitize=memory`, which catches uninitialized reads.
- **The engine side** runs the program in Node with `name.in` as the input followed by end of input, and must give the same bytes and exit status. It also runs it twice and must give identical results ([principles](README.md#principles)).
- **What a case avoids**: printing addresses ([memory](memory.md#pointers)), depending on evaluation order ([language](language.md#standard-and-target)) or on the order of equal elements in `qsort`, printing transcendental math results to the last digit ([libc](libc.md#math)), and calling `time` or `clock`.
- The expected files are committed, so the tests run without a compiler. CI regenerates them, and fails if any differs, whenever the corpus or the compiler image changes.
- The corpus is also the workload for measuring the [limits](limits.md#rules).

## Engine tests

- **A case** is a program, optionally its input, and its expected end as JSON: the output written, then either the diagnostic (code, args, range and, during the run, stack, [errors](errors.md#format)) or the exit status and the [leak report](memory.md#leak-report).
- Every diagnostic code has at least one case, and every undefined behavior a phase detects is in its exit tests ([roadmap](roadmap.md)).
- They run against the engine only: native builds of these programs have undefined behavior or do not compile.

## End-to-end tests

- **Against the build**: they run on the production build served by the Compose file's pinned static-web-server image with its configuration file, headers included ([deployment](deployment.md#what-the-repository-ships)), never on `pnpm dev`; a CSP violation the page reports fails the test ([security](security.md#headers)).
- **Minimal on purpose**: a few flows that only the real page can check, in Chromium: run a program and see its output; type input while it waits; Stop a loop; see a diagnostic in the console and its marker in the editor; reload and keep the code.
- **Exit tests are engine and oracle tests** wherever the engine alone can check them; a phase adds an end-to-end test only for a flow that needs the page.
- **Not tested automatically**: the look and feel of the UI (layout, the debugger, the memory view). The project owner reviews it by hand on each release, together with Firefox and Safari ([browser support](frontend.md#browser-support)).

## Robustness

- A property test feeds the engine random and mutated sources (from the corpus, cut and recombined), with a small step budget, and checks that the engine never throws: every run ends in an exit or a diagnostic, never in what the Worker would report as `engine.internal` ([architecture](architecture.md#components)).

## Differential fuzzing (planned)

Random programs from Csmith compared against GCC ([roadmap](roadmap.md#in-the-roadmap)). It uses the whole subset up to 1.0.
- **Generation** turns off what the subset lacks: `--no-jumps`, `--no-bitfields`, `--no-volatiles`, `--no-volatile-pointers`, `--no-packed-struct`, `--no-inline-function`, `--no-builtins` and `--no-argc` (floats are off by default).
- **A runtime header of our own** replaces Csmith's (`csmith.h` and its includes): the checksum and safe-math functions written only with the subset, so no `inline`, `#pragma` or extension slips in.
- **GCC side**: built as the oracle tests build ([oracle tests](#oracle-tests)), UBSan included; a program GCC's sanitizer reports is Csmith's fault and is discarded.
- **Compared**: the whole `stdout` and the exit status. A run that hits a resource limit (`limit.steps`, `limit.stack`, `limit.static_data`, `limit.nesting`, `limit.source`) is discarded; any other diagnostic, or a difference, is a failure to investigate.

## CI

- **On every push**: Biome, the TypeScript check, the unit, oracle, engine, robustness and end-to-end tests, the dependency license check ([licensing](licensing.md#allowed-licenses)), the docs site build ([docs site](docs-site.md)), and `python3 design/check_links.py`.
- **When the corpus or the compiler image changed**, also the oracle regeneration.
- **On pushes to `main`**, also the docs site deploy to GitHub Pages ([docs site](docs-site.md#hosting)).
- **Hardened**: actions are pinned by commit hash, and pull requests run with a read-only token and no secrets ([security](security.md#dependencies)). The native builds of the oracle and fuzzing programs run with CPU, memory and time limits and no network.
- The end-to-end tests also start the Compose file's static-web-server image, next to the CI container.
- Runs on x86-64 Linux ([language](language.md#standard-and-target)) in a container image pinned by digest, which holds the GCC and Clang the expected results come from. Changing a compiler version is a change to that image, and its new expected results show in review.
