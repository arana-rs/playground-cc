# Deployment

> Part of the [playground-cc spec](../spec.md). Related: [frontend](frontend.md).

- The site is the static output of the [frontend](frontend.md) build. There is no backend.
- It is served by [static-web-server](https://static-web-server.net/) on a self-managed VPS.
- TLS and the hostname live in the VPS's own reverse proxy, in front of static-web-server.
- Client-side routes fall back to `index.html` (static-web-server's page fallback), so reloading any route works.
