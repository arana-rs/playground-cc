# AGENTS.md

playground-c: browser-based C playground. The repo is in the specification
phase: `docs/` is the product; no code exists yet.

## Read first
- `docs/spec.md`: principles and the map of fragments. Read it, then only the
  fragments in `docs/spec/` your task needs. The spec is the source of truth:
  if code and spec disagree, the spec wins until it is changed on purpose.
- `docs/spec/roadmap.md`: phases (alpha 0.1 to 0.6 with the MVP, beta 0.7 to 1.0, In the
  roadmap, Not on the roadmap).

## Working on the spec
- The spec holds decisions only: no research notes, benchmarks, alternatives
  considered or drafts. Those go in a scratch directory outside the repo.
- The roadmap changes only when the user decides: never add a feature, or move
  one between phases, on your own. New features come from user requests.
- Prefer the simplest design with the least logic. No abstraction before a
  second implementation exists.
- One topic per file in `docs/spec/`. A new file needs a row in the Map table
  of `docs/spec.md`, or no one will find it.
- After every edit: `python3 docs/check_links.py` (must report 0 broken links and
  0 error code problems). A new error code goes in `docs/spec/errors.md`.

## Language
- Code, identifiers, comments, logs, commits and docs are in English.
- UI strings live only in the message catalogs (`es`, `en`); never hardcoded.

## Git
- Conventional commits (`docs(spec): …`, `feat(api): …`). Never commit
  `.env`, `secrets/` or `data/` (see `.gitignore`).
