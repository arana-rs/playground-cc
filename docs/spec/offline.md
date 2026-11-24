# Offline

> Part of the [playground-cc spec](../spec.md). Related: [deployment](deployment.md), [architecture](architecture.md), [security](security.md).

Once loaded, the playground keeps working without a connection (0.11, 1.0, [principles](../spec.md#principles)).

## Service worker

- **A service worker caches the whole build** on the first visit: the page, its scripts and styles, the Worker and the catalogs. The build writes the list of files, with their content hashes, into the service worker script itself, so nothing is left out and nothing else is cached.
- **Cache first**: every request is answered from the cache. The site makes no other request of its own ([principles](../spec.md#principles)).
- **The first visit needs the network**; after it, the page, Run, the debugger and everything else work offline, for as long as the browser keeps the cache (Safari may clear it after weeks without a visit; the next visit then needs the network again).
- It is a plain service worker written for the site, with no library: it caches one list and serves from it.

## Updates

- **Found by the service worker script**: the browser checks it for changes, and since the file list and hashes are inside it, any new build changes its bytes.
- **In the background**: the new version downloads while the current one keeps serving, so every open tab keeps its page and Worker from the same build ([worker protocol](worker-protocol.md#rules)).
- **Taking over**: the page shows a notice that a new version is ready, and its button activates it. Otherwise it activates the next time the playground is opened with no tab of it left open.
- **Every tab moves together**: when the new version activates, every open tab reloads into it, a tab with an active run, debug session or memory view session once that ends. Only then are the old caches deleted, so no tab is left needing files that are gone.

## Caching headers

static-web-server sends ([deployment](deployment.md)):
- files whose names carry a content hash (scripts, styles, the Worker): cached for a year, as immutable;
- `index.html`, the service worker and every other file without a hash in its name (`LICENSE.txt`, `THIRD-PARTY-LICENSES.txt`): `no-cache`, so the first visit, and each check for a new version, gets the current ones.
