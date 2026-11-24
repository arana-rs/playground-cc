# Licensing

> Part of the [playground-cc spec](../spec.md). Related: [engine](engine.md), [deployment](deployment.md).

playground-cc is **AGPL-3.0** ([LICENSE](../../LICENSE)).

- **What it covers**: the playground's own code (the engine, its C standard library subset, the Worker and the UI) and everything built from it.
- **What it does not cover**: the C programs users write and run in the playground, and their output. They belong to whoever wrote them. A program runs inside the engine in the user's own browser and is never distributed together with playground-cc's code.
- **Reference compilers**: GCC and Clang are run only by the oracle tests, to compare outputs. They are not linked into the site or shipped with it, so their licenses place no obligation on playground-cc.
