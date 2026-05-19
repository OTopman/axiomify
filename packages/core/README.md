# @axiomify/core


[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)

The framework-agnostic engine behind Axiomify. Router, AJV validator, hook manager, dispatcher, module system.

## Install

```bash
npm install @axiomify/core zod
```

## Quick example

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify({ logger: console });
app.enableRequestId();  // opt-in X-Request-Id (off by default)

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string(), email: z.string().email() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: 'usr_1', name: req.body.name });
  },
});

new NativeAdapter(app, { port: 3000 }).listen(() => console.log('Ready on 3000'));
```

## What's in this package

- `Axiomify` class — app construction, route/hook/group/plugin registration
- `Router` — radix-trie router with named params, wildcards, HEAD auto-handling
- `ValidationCompiler` — AJV + transform-aware Zod integration
- `HookManager` — microtask-free hook execution with fast paths
- `RequestDispatcher` — per-request orchestration
- `ADAPTER_LOCK_TOKEN` — adapter authentication symbol
- `AxiomifyLogger` — injectable structured logger interface

## Documentation

See [docs/[./packages/core.md](./packages/core.md)](https://github.com/OTopman/axiomify/blob/main/docs/packages/core.md) for the full API reference.

## v5 migration notes

- `X-Request-Id` is now opt-in: call `app.enableRequestId()` explicitly
- `app.lockRoutes(reason)` → `app.lockRoutes(ADAPTER_LOCK_TOKEN, reason)` — adapters authenticate with the symbol from `@axiomify/core`
- `app.serializer` is a read-only getter; use `app.setSerializer(fn)`. The 4.x 5-arg positional form `(data, message, statusCode, isError, req) => ...` was removed in 5.0 — only the single-argument `({ data, message, statusCode, isError, req }) => ...` form is accepted, and async serializers throw at adapter construction
- `route.meta` → `route.openapi` (deprecated alias kept through 5.x, removed in 6.0). Field shape mirrors the OAS 3.1.0 Operation Object — see [openapi docs](https://github.com/OTopman/axiomify/blob/main/docs/packages/openapi.md)
- `RouteMeta` type was renamed to `OpenApiOperation` in 5.0 (alias kept through 5.x, removed in 6.0); in 6.0 the alias is removed
- `AppPlugin` type alias removed (the 1-arg `(app) => void` shape still works at runtime as an `AppConfigurator`)
