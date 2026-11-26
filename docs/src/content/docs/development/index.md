---
title: Overview
description: Building, testing and hosting playground-cc.
---

This section covers building and testing playground-cc, its architecture as
built, and hosting it.

No release of the playground has been published yet. For now, only the docs
site can be built.

## The docs site

The docs site lives in `docs/`, a package of the pnpm workspace. From the
repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter docs dev     # local server at http://localhost:4321/playground-cc/
pnpm --filter docs build   # static site in docs/dist/
```

Every page exists in English and in Spanish (under `es/`).
