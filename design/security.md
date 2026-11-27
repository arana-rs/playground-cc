# Security

> Part of the [playground-cc spec](README.md). Related: [deployment](deployment.md), [architecture](architecture.md), [frontend](frontend.md), [limits](limits.md), [sharing](sharing.md), [docs site](docs-site.md).

There is no server code, no account and no stored data outside the user's browser, so the attack surface is the page itself. What it has to resist is hostile code: a C program the user did not write, pasted from elsewhere, or arriving through a share link (0.11, 1.0) or an imported file (planned). Unmarked rules are MVP.

## User code never becomes JavaScript or HTML

- **The engine interprets C; it never generates JavaScript.** There is no `eval`, `new Function` or `setTimeout` with a string anywhere in the site, and the CSP forbids them ([headers](#headers)). A C program can only do what the engine's interpreter lets it do.
- **Text is always text**: everything derived from a program, its input or a shared or imported file (the source in the editor, file names, program output, input echo, diagnostic args, the debugger's output and the memory view's labels and values) is rendered as text nodes, never as HTML (`innerHTML`, `dangerouslySetInnerHTML`), so `printf("<script>…")` prints those characters.
- **A shared program never runs on its own** (0.11, 1.0): opening a share link, or importing a file (planned), loads the code into the editor; it runs only when the user starts it (Run, Debug or Memory).
- **Decoding is bounded** (0.11, 1.0): a share link is decoded with its length, its decompressed size, the file limit and the source size limit checked as it goes, and an imported file (planned) has its size checked before it is read ([sharing](sharing.md), [limits](limits.md#run-limits)), so a crafted or oversized payload is rejected with a notice, leaving the editor as it was, before it can freeze the page.

## A program can only hurt its own run

- It runs in the Worker, apart from the UI, and every resource it uses has a limit (steps, before the run too, output, stack, heap, static data, nesting, [limits](limits.md)), so the worst a hostile program does is end with a diagnostic, or be stopped.
- It has no way out of the engine: no files, network, clock or randomness ([libc](libc.md#determinism)).

## Headers

static-web-server sends these on every response, except its fixed `405` page for methods other than `GET`, `HEAD` and `OPTIONS` ([deployment](deployment.md#what-the-repository-ships)):

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

- `script-src 'self'` without `'unsafe-eval'` is what forbids generating code. `style-src` allows inline styles because CodeMirror injects its own; scripts stay forbidden inline.
- `Cross-Origin-Opener-Policy` cuts the reference between the page and any window of another origin that opened it, so that window cannot navigate or reach the page. The site needs no cross-origin isolation, so no `Cross-Origin-Embedder-Policy` ([engine](engine.md#execution-model)).
- Everything the site loads comes from its own origin: no CDN, no external fonts or scripts ([principles](README.md#principles)).
- HTTPS and HSTS belong to whoever hosts the site; on the official instance, its reverse proxy adds them and passes these headers through unchanged ([deployment](deployment.md#the-official-instance)).

## Dependencies

- The pnpm lockfile pins every dependency, and CI installs with the lockfile frozen.
- **Install scripts** run only for the packages listed in pnpm's `onlyBuiltDependencies`; every other package's are skipped.
- **CI** pins its actions by commit hash, and runs pull requests with a read-only token and no secrets ([testing](testing.md#ci)). It holds no credentials for the official instance, which is deployed by hand ([deployment](deployment.md#the-official-instance)). The only thing CI deploys is the docs site, to GitHub Pages on pushes to `main`, with the short-lived token GitHub Actions issues to that job ([docs site](docs-site.md#hosting)).
- Nothing else applies: there are no secrets, tokens or user data to protect, and `localStorage` holds only the user's own code and preferences.
