# AGENTS.md

playground-cc: browser-based C playground. Implementation follows
`design/roadmap.md` phase by phase; the current phase is the first one whose
exit tests do not all pass.

Two kinds of documentation, never mixed:
- `design/` is the spec: the target, up to 1.0 and beyond.
- `docs/` is the Starlight docs site: only what is built and released
  (the last phase closed on `main`). See `design/docs-site.md`.

## Read first
- `design/README.md`: principles and the map of fragments. Read it, then only the
  fragments in `design/` your task needs. The spec is the source of truth:
  if code and spec disagree, the spec wins until it is changed on purpose.
- `design/roadmap.md`: phases (alpha 0.1 to 0.6 with the MVP, beta 0.7 to 1.0, In the
  roadmap, Not on the roadmap).

## Commands
Run from the repository root.
- `pnpm install --frozen-lockfile`: install the workspace.
- `pnpm check`: everything CI runs (lint, typecheck, tests, spec links). Must
  pass before a step is done.
- `pnpm lint` (Biome; `pnpm format` fixes what it can), `pnpm typecheck`,
  `pnpm test`; one package: `pnpm --filter engine test`.

## Working on the spec
- The spec holds decisions only: no research notes, benchmarks, alternatives
  considered or drafts. Those go in a scratch directory outside the repo.
- The roadmap changes only when the user decides: never add a feature, or move
  one between phases, on your own. New features come from user requests.
- Prefer the simplest design with the least logic. No abstraction before a
  second implementation exists.
- One topic per file in `design/`. A new file needs a row in the Map table
  of `design/README.md`, or no one will find it.
- After every edit: `python3 design/check_links.py` (must report 0 broken links and
  0 error code problems). A new error code goes in `design/errors.md`.

## Working on a phase
- Build only what the roadmap lists for the current phase, with the details its
  fragments give: nothing from a later phase, even when it is easy to add.
  Unmarked behavior in fragments is MVP scope (0.1 to 0.6), not current-phase
  scope: the roadmap says which phase builds it.
- A phase is done when its exit tests (for 1.0, its close list) and every
  earlier phase's pass.
- If the code exposes a gap or a contradiction in the spec, stop and ask. The
  spec changes on purpose first, then the code; code never diverges silently.
- Work happens on `dev`; `main` receives only closed phases, because the docs
  site deploys from it. Closing a phase: its docs pages in `en` and `es`, then
  the owner merges to `main` and tags `v<phase>.0` (`v0.1.0`, `v1.0.0`).
- A new dependency gets an exact version and, if it ships in the site's bundle
  or the docs site, a license on the allowlist (`design/licensing.md`). Add it
  to pnpm's `onlyBuiltDependencies` only when its install script is required.

## Working on the docs site
- Document a feature in `docs/` only in the change that closes its phase;
  never document a later phase, "(planned)" or unbuilt behavior.
- Every page exists in `en` (root) and `es` (`es/`); change both together.
- After every edit: `pnpm --filter docs build` (must succeed).

## Language
- Code, identifiers, comments, logs and the spec (`design/`) are in
  English; the docs site (`docs/`) is in `en` and `es`.
- UI strings live only in the message catalogs (`es`, `en`); never hardcoded.

## Git
- Agents never commit, push or tag; the owner does.
