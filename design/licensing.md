# Licensing

> Part of the [playground-cc spec](README.md). Related: [libc](libc.md), [frontend](frontend.md), [frontend screens](frontend-screens.md), [offline](offline.md), [testing](testing.md#ci), [deployment](deployment.md), [docs site](docs-site.md).

playground-cc is **AGPL-3.0-or-later** ([LICENSE](../LICENSE)): the GNU Affero General Public License, version 3 or, at the user's option, any later version. Everything the site ships must be compatible with it, the site carries every notice its parts require, and every visitor can get its source.

## What the license covers

- **What it covers**: the playground's own code (the engine, its C standard library subset, the Worker and the UI) and everything built from it.
- **What it does not cover**: the C programs users write and run in the playground, and their output. They belong to whoever wrote them. A program runs inside the engine in the user's own browser and is never distributed together with playground-cc's code.
- **Reference compilers**: GCC and Clang are run only by the oracle tests, to compare outputs. They are not linked into the site or shipped with it, so their licenses place no obligation on playground-cc.

## Allowed licenses

- **Allowed** for what the site ships (dependencies, and code or assets copied or ported from other projects), by SPDX id:
  - permissive: `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `Zlib`, `0BSD`, `CC0-1.0`, `Unlicense`, `Unicode-3.0`;
  - weak copyleft: `LGPL-2.1-or-later`, `LGPL-3.0-only`, `LGPL-3.0-or-later`, `MPL-2.0`;
  - strong copyleft: `GPL-2.0-or-later`, `GPL-3.0-only`, `GPL-3.0-or-later`, `AGPL-3.0-only`, `AGPL-3.0-or-later`.
- **Not allowed**: `GPL-2.0-only`, `LGPL-2.1-only` and `MPL-2.0-no-copyleft-exception` (incompatible with AGPL-3.0), non-commercial or source-available licenses, and anything without a license.
- **Enforced by the build, not by review**: the build lists the packages whose modules end up in the bundle (the page's and the Worker's), whether they are declared as dependencies or development dependencies, and checks their licenses against the allowlist kept in the repo (`web/license-allowlist.json`, the list above). A package whose `license` is not an SPDX expression the list satisfies, or that has no license file, fails the build, and so does a module of unknown origin. It runs in CI ([testing](testing.md#ci)) and fails on any license outside the list. Adding a license to the list is a deliberate change to that file. Development tools that put nothing in the bundle are not checked. The docs site is a separate site, outside this check: the packages it ships to its visitors (Astro, Starlight, Pagefind) are checked against the list by hand when adopted ([docs site](docs-site.md)).
- **Copied, ported and generated code** is not a package, so the check cannot see it. Copied or ported code lives in its own directory with the original license file beside it and keeps its original copyright headers; adopting it means checking that license against the list by hand. Today this is the shadcn/ui components copied into `web/` (MIT, [frontend](frontend.md#technologies)), the Tokyo Night colors copied from tokyonight.nvim (Apache-2.0, `web/src/tokyonight/`), and the transcendental math functions ported from musl (MIT, [libc](libc.md#math)). Code that a build tool generates into the bundle (Paraglide's runtime and message functions, Tailwind CSS's styles) carries that tool's license, checked against the list by hand when the tool is adopted, like copied code; the build's own runtime helpers (Vite's and Rolldown's) are found in the bundle like packages.

## Notices and source (AGPL sections 6 and 13)

- **Every visitor receives the site's code**, so the site itself must carry the notices and offer the source, whoever hosts it, modified or not.
- **Own license**: the build ships playground-cc's `LICENSE` as `LICENSE.txt` next to the page.
- **Third-party notices**: the build writes `THIRD-PARTY-LICENSES.txt`, never by hand, with the license (and `NOTICE` file, if any) of every package in the bundle, from the same list the check uses, of every copied or ported directory, and of every build tool whose generated code ships. It starts by pointing to `LICENSE.txt`.
- Both are served as plain text next to the page and cached for offline use like the rest of the build (0.11, 1.0, [offline](offline.md#service-worker)).
- **In the UI**: the settings menu has a **Source code** link and a **Licenses** link, which opens `THIRD-PARTY-LICENSES.txt` ([frontend screens](frontend-screens.md#desktop)). Both open in a new tab, with `rel="noopener noreferrer"`.
- **The source URL** is set at build time (`VITE_SOURCE_URL`), by default the official repository at the release's tag (`https://github.com/arana-rs/playground-cc/tree/v<version>`, the version of `web/package.json`). `THIRD-PARTY-LICENSES.txt` gives it too, after the pointer to `LICENSE.txt`.
- **Only in the build**: the development server has neither file, since the bundle's packages are known only once it is built. Anyone who hosts playground-cc for others must point it to the exact source of the build they serve, which is what the AGPL asks of them.
