# Security

> Part of the [playground-cc spec](../spec.md). Related: [deployment](deployment.md), [architecture](architecture.md), [frontend](frontend.md), [limits](limits.md).

There is no server code, no account and no stored data outside the user's browser, so the attack surface is the page itself. What it has to resist is hostile code: a C program the user did not write, pasted from elsewhere or, from 0.11 (1.0), arriving through a share link or an imported file. Unmarked rules are MVP.

## User code never becomes JavaScript or HTML

- **The engine interprets C; it never generates JavaScript.** There is no `eval`, `new Function` or `setTimeout` with a string anywhere in the site, and the CSP forbids them ([headers](#headers)). A C program can only do what the engine's interpreter lets it do.
- **Text is always text**: the source in the editor, file names (0.9, 1.0), program output, input echo and diagnostic args are rendered as text nodes, never as HTML (`innerHTML`, `dangerouslySetInnerHTML`), so `printf("<script>…")` prints those characters.
- **A shared program never runs on its own** (0.11, 1.0): opening a share link or importing a file loads the code into the editor; it runs only when the user presses Run.
- **Decoding is bounded** (0.11, 1.0): a share link or imported file is decoded with the source size limit checked as it goes ([limits](limits.md#run-limits)), so a crafted or oversized payload is rejected with a notice, leaving the editor as it was, before it can freeze the page.

## A program can only hurt its own run

- It runs in the Worker, apart from the UI, and every resource it uses has a limit (steps, output, stack, heap, [limits](limits.md)), so the worst a hostile program does is end with a diagnostic, or be stopped.
- It has no way out of the engine: no files, network, clock or randomness ([libc](libc.md#determinism)).

## Headers

static-web-server sends these on every response ([deployment](deployment.md)):

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |

- `script-src 'self'` without `'unsafe-eval'` is what forbids generating code. `style-src` allows inline styles because CodeMirror injects its own; scripts stay forbidden inline.
- Everything the site loads comes from its own origin: no CDN, no external fonts or scripts ([principles](../spec.md#principles)).
- HTTPS and HSTS belong to the reverse proxy in front of static-web-server.

## Dependencies

- The pnpm lockfile pins every dependency, and CI installs with the lockfile frozen.
- Nothing else applies: there are no secrets, tokens or user data to protect, and `localStorage` holds only the user's own code and preferences.
