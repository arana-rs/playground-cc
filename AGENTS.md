# AGENTS.md

playground-cc: browser-based C playground. The repo is in the specification
phase: `design/` is the product; no playground code exists yet.

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

## Working on the docs site
- Document a feature in `docs/` only in the change that closes its phase;
  never document a later phase, "(planned)" or unbuilt behavior.
- Every page exists in `en` (root) and `es` (`es/`); change both together.
- After every edit: `pnpm --filter docs build` (must succeed).

## Language
- Code, identifiers, comments, logs, commits and the spec (`design/`) are in
  English; the docs site (`docs/`) is in `en` and `es`.
- UI strings live only in the message catalogs (`es`, `en`); never hardcoded.

## Git
- Conventional commits (`docs(spec): …`, `feat(api): …`). Never commit
  `.env`, `secrets/` or `data/` (see `.gitignore`).
