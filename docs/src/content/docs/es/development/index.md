---
title: Introducción
description: Compilar, probar y alojar playground-cc.
---

Esta sección explica cómo compilar y probar playground-cc, su arquitectura tal
como está construida y cómo alojarlo.

Todavía no se ha publicado ninguna versión del playground. Por ahora solo se
puede compilar el sitio de documentación.

## El sitio de documentación

El sitio de documentación está en `docs/`, un paquete del workspace de pnpm.
Desde la raíz del repositorio:

```sh
pnpm install --frozen-lockfile
pnpm --filter docs dev     # servidor local en http://localhost:4321/playground-cc/
pnpm --filter docs build   # sitio estático en docs/dist/
```

Cada página existe en inglés y en español (bajo `es/`).
