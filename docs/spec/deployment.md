# Deployment

> Part of the [playground-cc spec](../spec.md). Related: [frontend](frontend.md), [security](security.md).

- The site is the static output of the [frontend](frontend.md) build. There is no backend.
- It is served by [static-web-server](https://static-web-server.net/) on a self-managed VPS.
- TLS and the hostname live in the VPS's own reverse proxy, in front of static-web-server.
- static-web-server sends the security headers on every response ([security](security.md#headers)), and the caching headers the service worker relies on (1.0, [offline](offline.md#caching-headers)).
- The app is one page at `/` with no client-side routes ([frontend](frontend.md#one-page)), so no page fallback is configured: any path without a matching static file is a 404.
