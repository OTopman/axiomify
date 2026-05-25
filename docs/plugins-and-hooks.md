# Plugins and Hooks

## Two levels of reuse

**Hooks** — global lifecycle callbacks. Run on every matching request, in every adapter.

**Route plugins** — per-route middleware functions. Run only for routes that declare them.

## Hook execution order

```
Request arrives
      │
      ▼
onRequest hooks        ← global, before any routing
      │
      ▼
Router lookup          ← single pass (adapter's own router or Axiomify trie)
      │
      ▼
onPreHandler hooks     ← global, receives { route, params }
      │
      ▼
route.plugins[0..n]    ← per-route middleware: auth, rate-limit, etc.
      │
      ▼
Validation             ← AJV + optional Zod transform pass
      │
      ▼
Handler
      │
      ▼
onPostHandler hooks    ← global, receives { route, params }
      │
      ▼
onClose hooks          ← always runs, even after errors

On throw anywhere above handler:
      │
      ▼
onError hooks → onClose hooks
```

**Key points:**
- `onPreHandler` runs at dispatch time (not compiled into the per-route pipeline), so hooks added after route registration still execute
- `onClose` always runs — use it for cleanup (metrics, logging) regardless of outcome
- `onError` does NOT prevent `onClose` from running — both are called with `runSafe()` (errors swallowed and logged)

## Hook fast path (v5)

`HookManager.run()` returns `undefined` (not a Promise) when no hooks of a given type are registered. Callers check the return value before `await`:

```ts
const ret = hooks.run('onRequest', req, res);
if (ret) await ret;  // only allocates a microtask when there are hooks
```

Zero Promise allocation in the zero-hook fast path. Single-handler lists call the handler directly without a loop.

Multi-handler lists are **snapshotted before iteration**, so a hook that calls `app.addHook(type, ...)` of its own type during execution does NOT mutate the in-progress iteration — added hooks take effect on the *next* request. This matches the convention used by Express / Fastify / Koa.

## Global hooks

```typescript
// All hooks are optional — only register what you need
app.addHook('onRequest', async (req, res) => {
  // Good for: auth token extraction, CORS preflight, request logging
});

app.addHook('onPreHandler', async (req, res, { route, params }) => {
  // Good for: rate limiting by route, per-route auth checks
  // route.openapi?.tags is available here for tag-based auth
  // (route.meta still works as a deprecated alias through 5.x)
});

app.addHook('onPostHandler', async (req, res, { route, params }) => {
  // Good for: response logging, metrics recording
});

app.addHook('onError', async (err, req, res) => {
  // Good for: error logging, custom error responses
  // If you send a response here, the default error handler is skipped
});

app.addHook('onClose', async (req, res) => {
  // Good for: cleanup regardless of success or failure
  // Runs after onError (or after onPostHandler on success)
});
```

## Route plugins

Route plugins are `RouteMiddleware` functions — the same `(req, res)` contract as handlers:

```typescript
import { createAuthPlugin } from '@axiomify/auth';
import { createRateLimitPlugin } from '@axiomify/rate-limit';

const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });
const limiter = createRateLimitPlugin({ max: 100, windowMs: 60_000, store });

app.route({
  method: 'POST',
  path: '/api/jobs',
  plugins: [requireAuth, limiter],  // run in order, before handler
  handler: async (_req, res) => {
    res.send({ ok: true });
  },
});
```

## Group plugins

Group-level plugins are inherited by all routes in the group:

```typescript
app.group('/api/private', { plugins: [requireAuth] }, (group) => {
  group.route({ method: 'GET', path: '/me', handler: getMeHandler });
  group.route({ method: 'POST', path: '/posts', handler: createPostHandler });

  // Nested group — inherits requireAuth + adds requireAdmin
  group.group('/admin', { plugins: [requireAdmin] }, (admin) => {
    admin.route({ method: 'DELETE', path: '/users/:id', handler: deleteUserHandler });
  });
});
```

## When to use hooks vs plugins

| Concern | Hook | Plugin |
|---|---|---|
| Request ID injection | `onRequest` ✓ | |
| CORS headers | `onRequest` ✓ | |
| Auth token extraction (store in `req.state`) | `onRequest` ✓ | |
| Rate limit (global, all routes) | `onPreHandler` ✓ | |
| Rate limit (specific routes) | | Plugin ✓ |
| Role check (reads `route.openapi?.tags` / `route.meta?.tags`) | `onPreHandler` ✓ | |
| Auth enforcement (specific routes) | | Plugin ✓ |
| Response logging | `onPostHandler` ✓ | |
| Error alerting | `onError` ✓ | |
| Request cleanup | `onClose` ✓ | |

## Global plugin installers

Many packages expose `useX(app, options)` helpers that register hooks and/or routes:

```typescript
import { useCors }      from '@axiomify/cors';
import { useHelmet }    from '@axiomify/helmet';
import { useLogger }    from '@axiomify/logger';
import { useMetrics }   from '@axiomify/metrics';
import { useOpenAPI }   from '@axiomify/openapi';
import { useRateLimit } from '@axiomify/rate-limit';
import { useSecurity }  from '@axiomify/security';
import { useGraphQL }   from '@axiomify/graphql';

// Call before adapter.listen() — hooks are registered in order
useCors(app, { origin: ['https://example.com'], credentials: true });
useHelmet(app);
useLogger(app, { sensitiveFields: ['authorization', 'password'] });
useMetrics(app, { path: '/internal/metrics' });
```

## Module system (v5)

For plugins with dependencies, use `AppModule` with topological resolution:

```typescript
import { ADAPTER_LOCK_TOKEN } from '@axiomify/core';

app.use({
  name: 'database',
  register: (app, ctx) => {
    ctx.provide('db', createPool(process.env.DATABASE_URL!));
  },
});

app.use({
  name: 'auth',
  dependencies: ['database'],   // resolved before 'auth' regardless of call order
  register: (app, ctx) => {
    const db = ctx.resolve<Pool>('database');
    app.addHook('onRequest', createAuthMiddleware(db));
  },
});
```

Cycles produce a clear error naming the modules involved.
