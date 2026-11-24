# Frontend

> Part of the [playground-cc spec](../spec.md). Related: [architecture](architecture.md), [worker protocol](worker-protocol.md), [errors](errors.md), [deployment](deployment.md).

The base of the web app: technologies, the single page, diagnostics, preferences, saving the code, i18n, shortcuts, accessibility and browser support. The layout and where the 1.0 features go are in [frontend screens](frontend-screens.md).

## Technologies

| Area | Technology | Notes |
|---|---|---|
| Base | Vite + React + TypeScript | The `web/` package of the pnpm workspace ([architecture](architecture.md#repository-layout)). The build is static files only: no server-side rendering and no server code |
| Editor | CodeMirror 6 with `@codemirror/lang-cpp` | Shows diagnostics as lint markers ([diagnostics](#diagnostics)) |
| UI | Tailwind v4 + shadcn/ui + lucide | shadcn/ui components are copied into the repo; dark and light themes through CSS variables |
| i18n | Paraglide JS (`es`, `en`) | Typed message functions, one per diagnostic code |
| State | React state | No state library until shared UI state outgrows React state |
| C engine | `engine/` package in a Web Worker | [architecture](architecture.md#components) |
| Fonts | System font stacks | No web fonts, so nothing is downloaded beyond the site and nothing is called outside it |
| Quality | Vitest, Playwright, Biome | |

## One page

- The app is one page at `/`, with no router. A router comes back only if a second screen appears (exercises, planned).
- Sharing a program by URL (0.11, 1.0, [sharing](sharing.md)) puts it in the URL fragment (`#…`), which the browser never sends to the server, so shared code stays out of server logs ([principles](../spec.md#principles)). A shared program never runs until the user presses Run ([security](security.md)).

## Diagnostics

- Every diagnostic shows in the console, with its message and, when it has one, its call stack ([errors](errors.md#format)).
- When it has a range, it also shows in the editor as a lint marker at that range.

## Preferences

- Language and theme follow the browser and the system. The language is matched by the browser's base tag (`es-MX` → `es`), with `en` when none matches.
- A choice made in the UI is stored in `localStorage`, per device. When `localStorage` is unavailable, the defaults apply and choices last only until the page is closed.

## Saving the code

- The code is saved in `localStorage` on every change, after a short pause in typing, and restored when the page loads (0.6). With nothing saved, the page starts with a hello world program.
- When `localStorage` is unavailable or full, the playground keeps working and shows a notice that the code will not survive a reload.
- Saved data that cannot be read is replaced by the hello world program.
- Two tabs save to the same place: the last one to save wins, with no live sync between them.
- A share link (0.11, 1.0) opens its program without overwriting the saved code; the saved code is replaced only once the user edits the shared one, after a confirmation when the saved code is the user's own ([sharing](sharing.md#opening-a-link)).
- Saved code is never migrated: code that a new release no longer accepts gets its diagnostics when it runs.

## i18n

- Every UI string comes from the message catalogs; none is hardcoded.
- Each diagnostic code has a message function whose parameters are the code's args ([errors](errors.md#format)); a code without a message shows a generic message with the code.
- Numbers are formatted with the user's locale, and plurals use Paraglide variants over `Intl.PluralRules`, never concatenated text.
- Program output is never translated: it is shown as the program wrote it.

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+Enter (⌘+Enter on macOS) | Run, or Stop while a run is active (the Run button is the Stop button, [worker protocol](worker-protocol.md#rules)). Works anywhere on the page while Run or Stop is enabled (not during a debug session or with the memory view open), and replaces CodeMirror's own binding for those keys |
| Ctrl+C, in the input field during a debug session | Pause the running program, as in gdb ([debugger](debugger.md#session)). Only with no text selected; with a selection it copies |
| Ctrl+D, in the input field | End of input, the same as the console's button ([libc](libc.md#input)). Ctrl on macOS too, as in a terminal; it always prevents the browser's default (bookmarking, or deleting forward on macOS) |

## Accessibility

- Every action is reachable from the keyboard. In the editor, Tab indents; Escape and then Tab moves the focus out, as CodeMirror does.
- A polite live region announces when a run starts, waits for input and ends, and each diagnostic's message, so a screen reader hears what the console shows.
- With `prefers-reduced-motion`, there are no transitions or animations.

## Browser support

The last two major versions of Chrome, Edge, Firefox and Safari. The site needs module Workers, `TextDecoder` with streaming and `BigInt` (for exact `printf` output, [libc](libc.md#printf)), and no cross-origin isolation ([engine](engine.md#execution-model)).
