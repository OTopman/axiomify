# @axiomify/core

[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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
app.enableRequestId(); // opt-in X-Request-Id (off by default)

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

new NativeAdapter(app, { port: 3000 }).listen(() =>
  console.log('Ready on 3000'),
);
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

See [docs/packages/core.md](https://github.com/OTopman/axiomify/blob/main/docs/packages/core.md) for the full API reference.

## v5 migration notes

- `X-Request-Id` is now opt-in: call `app.enableRequestId()` explicitly
- `app.lockRoutes(reason)` → `app.lockRoutes(ADAPTER_LOCK_TOKEN, reason)` — adapters authenticate with the symbol from `@axiomify/core`
- `app.serializer` is a read-only getter; use `app.setSerializer(fn)`. The 4.x 5-arg positional form `(data, message, statusCode, isError, req) => ...` was removed in 5.0 — only the single-argument `({ data, message, statusCode, isError, req }) => ...` form is accepted, and async serializers throw at adapter construction
- `route.meta` → `route.openapi` (deprecated alias kept through 5.x, removed in 6.0). Field shape mirrors the OAS 3.1.0 Operation Object — see [openapi docs](https://github.com/OTopman/axiomify/blob/main/docs/packages/openapi.md)
- `RouteMeta` type was renamed to `OpenApiOperation` in 5.0 (alias kept through 5.x, removed in 6.0); in 6.0 the alias is removed
- `AppPlugin` type alias removed (the 1-arg `(app) => void` shape still works at runtime as an `AppConfigurator`)

## Validation Execution Order

When a request is dispatched, validation and hooks are executed in the following strict order:

1. **`onRequest` hooks**: Run immediately after request initialization.
2. **Route Matching & Extraction**: Path, query, and headers are parsed and matched.
3. **`onPreHandler` hooks**: Run before route-specific validation is performed.
4. **Input Validation**: `params`, `query`, `headers`, and `body` are validated using Zod/AJV schemas in that order. If validation fails, a `ValidationError` is thrown and processed via `onError` hooks.
5. **Route Handler**: The route-specific handler function is executed.
6. **`onPostHandler` hooks**: Run after the route handler successfully completes.
7. **Response Validation**: If a response schema is defined, the outgoing payload is validated. In development, a mismatch throws a `ValidationError`; in production, it is logged as an error and allowed to continue.
8. **`onError` hooks**: Run if any error is thrown during dispatch.
9. **`onClose` hooks**: Run after response headers are sent and connection/stream closes.

## Request State Immutability API

To prevent privilege escalation and coordinate data safely across hooks, `req.state` is a wrapped immutable object implementing the following methods:

- `req.state.set(key, value)`: Stores a value under the given key. Throws an error if the key has already been set (write-once immutability).
- `req.state.get(key)`: Retrieves the value associated with the key.
- If the key is `'user'`, the stored object is recursively frozen via `Object.freeze` to prevent downstream mutations.
- Direct property access (e.g., `req.state.key = value` and `req.state.key`) is proxied to the write-once set/get APIs for backwards compatibility.

## Core Configuration Options

When creating an `Axiomify` instance, you can configure these options:

- `strictSchema` (`boolean`, default: `false`): If `true`, throws a startup error when registering a route that has a typed handler but no schema definition. You can ignore this on specific routes by adding a `@axiomify-ignore-schema` comment.
- `routeConflict` (`'throw' | 'warn'`, default: `'throw'`): Determines whether to throw an error or emit a warning when registering conflicting parameterized route paths (e.g. `/users/:id` and `/users/:userId`).

## Custom Fallback Handlers

Use `app.setNotFoundHandler` and `app.setMethodNotAllowedHandler` to customize responses for missing routes and mismatched methods:

```typescript
app.setNotFoundHandler((req, res) => {
  res.status(404).send({ error: 'NotFound' }, 'Resource not found');
});

app.setMethodNotAllowedHandler((req, res) => {
  res.status(405).send({ error: 'MethodNotAllowed' }, 'Method not supported');
});
```

## Service Container Sealing

The dependency injection container is sealed after bootstrap (`app.listen()` or `app.build()`). Calling `provide` on the `AppContext` post-bootstrap throws an error. Use `app.forceProvide(token, value)` in tests to bypass the seal guard.

## Global Error Sanitization

In production, all database or internal system errors are masked as a generic 500 server error to prevent sensitive data leaks. You can use the exported `createErrorSanitizer` helper to safely map database driver errors (Prisma, MongoDB, Sequelize, etc.) to API errors in an `onError` hook:

```typescript
import { createErrorSanitizer } from '@axiomify/core';

const sanitizeError = createErrorSanitizer({ logger: app.logger });

app.addHook('onError', async (err, req, res) => {
  const sanitized = sanitizeError(err);
  if (sanitized) {
    res.status(sanitized.statusCode).send(
      {
        error: sanitized.message,
        data: sanitized.data,
      },
      sanitized.message,
    );
  }
});
```
