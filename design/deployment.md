# Deployment

> Part of the [playground-cc spec](README.md). Related: [frontend](frontend.md), [security](security.md), [offline](offline.md).

## What the repository ships

- The site is the static output of the [frontend](frontend.md) build. There is no backend.
- **A Docker Compose file with static-web-server and nothing else**: [static-web-server](https://static-web-server.net/) serves the build, with directory listing off and hidden files not served. Its configuration, headers included, is a file next to the Compose file, which the end-to-end tests use too. Its image is pinned by digest (`@sha256:…`), so a changed upstream tag never reaches a deploy; moving to a new version is a change to that digest, reviewed like the CI image ([testing](testing.md#ci)).
- static-web-server sends the security headers on every response, 404s included ([security](security.md#headers)), and the caching headers the service worker relies on (1.0, [offline](offline.md#caching-headers)).
- The app is one page at `/` with no client-side routes ([frontend](frontend.md#one-page)), so no page fallback is configured: any path without a matching static file is a 404.

## Hosting

- **How to host it is up to whoever hosts it**: the Compose file alone, or behind a reverse proxy of their own. TLS, the hostname and HSTS are outside what the repository ships.
- **The published address** is the host's choice too: Docker publishes on every interface by default, past the host's firewall; behind a proxy, the Compose file is published on `127.0.0.1` only.
- **`pnpm dev` is for one's own machine**: Vite's dev server serves the source tree, not the build, without the security headers and with a development tool's surface, so it listens on `localhost` (Vite's default) and is never exposed to others; serving others uses the Compose file. The end-to-end tests run against the build with the production headers, so what the CSP blocks shows there ([testing](testing.md#end-to-end-tests)).
- **An origin of its own**: wherever it runs, nothing else is served from the same scheme, host and port, so no other app shares its storage or its service worker.
- **HTTPS for offline**: browsers register the service worker only over HTTPS or on `localhost`, so a plain-HTTP host works but not offline ([offline](offline.md)).

## The official instance

The project owner's own stack, not part of the repository.
- static-web-server runs from the Compose file on a self-managed VPS, published on `127.0.0.1` only, behind the owner's reverse proxy.
- The proxy holds TLS and the hostname, redirects plain HTTP to HTTPS, passes static-web-server's headers through unchanged and adds HSTS.
- **Deploys are by hand**: the owner builds a tagged commit from a clean checkout, installing with the lockfile frozen, and copies the build to the VPS. CI holds no deploy credentials ([security](security.md#dependencies)).
