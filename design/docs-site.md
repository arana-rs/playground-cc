# Docs site

> Part of the [playground-cc spec](README.md). Related: [roadmap](roadmap.md), [architecture](architecture.md), [deployment](deployment.md), [security](security.md), [licensing](licensing.md).

This spec describes the playground it aims to be. The docs site, in `docs/`, describes the playground that exists.

## What it documents

- **Only the released playground**: the last phase closed on `main` ([roadmap](roadmap.md)). A feature's pages are written in the change that closes its phase. Nothing from a later phase, "(planned)" or not on the roadmap is documented.
- **The landing page names the documented release**, or says that no phase has been released yet.
- **Where the docs and this spec differ**, the spec holds the target and the docs hold the release. A difference is either a feature not built yet or a bug in the code, and the spec wins ([README](README.md)).

## Sections

| Section | For | Holds |
|---|---|---|
| Guide | Learners and teachers | Using the playground, the C it accepts, the run limits, every diagnostic and what it means |
| Development | Contributors and hosts | Building and testing, the architecture as built, hosting with the Compose file |

## Languages

- Every page exists in `en` and `es`, and a page is added or changed in both in the same change.
- English is served at the root path and Spanish under `/es/`.

## Technology

- **Starlight** (Astro), the `docs/` package of the pnpm workspace ([architecture](architecture.md#repository-layout)). The build is static files only.
- **Search** is Starlight's built-in Pagefind index, which runs in the page: the site calls no external service.

## Hosting

- **GitHub Pages**, at `https://arana-rs.github.io/playground-cc/`. Its origin is not the playground's, so the playground keeps an origin of its own ([deployment](deployment.md#hosting)).
- **Deployed by CI** on pushes to `main` that change `docs/`, the workspace's root files or its workflow. No other push or pull request builds or deploys it ([testing](testing.md#ci), [security](security.md#dependencies)).
- **No custom headers**: GitHub Pages cannot set response headers. The docs site holds no user code or data, so the playground's headers and CSP do not apply to it ([security](security.md#headers)).
