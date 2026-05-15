# @axiomify/core

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

See [docs/packages/core.md](../../docs/packages/core.md) for the full API reference.

## v5 migration notes

- `X-Request-Id` is now opt-in: call `app.enableRequestId()` explicitly
- `app.serializer = fn` → `app.setSerializer(fn)` (field is now a read-only getter)
- `app.lockRoutes(reason)` → `app.lockRoutes(ADAPTER_LOCK_TOKEN, reason)`
- `RoutePlugin` / `PluginHandler` → `RouteMiddleware` (old names deprecated, removed v6)
