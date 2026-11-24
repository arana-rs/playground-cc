# playground-c: specification

Browser-based C playground.

**How to read this spec.** This page holds the principles and a map. Each topic lives in its own file under [`spec/`](spec/), short enough to read on its own: read this page first, then only the fragments your task needs. Decisions live here; research notes and benchmarks do not.

---

## Principles

---

## Map

| Fragment | Read it for |
|---|---|
| [frontend](spec/frontend.md) | Frontend technology choices |
| [engine](spec/engine.md) | The C engine's execution model: resumable interpreter, interactive `stdin`, stepping, Stop and budgets |
| [deployment](spec/deployment.md) | Static hosting with static-web-server behind a TLS reverse proxy, route fallback |
| [roadmap](spec/roadmap.md) | Phases, each phase's exit tests and every feature's phase |

---

## Glossary
