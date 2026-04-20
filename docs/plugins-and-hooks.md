# Plugins and Hooks

## Two Levels of Reuse

Use hooks for app-wide lifecycle behavior.

Use route plugins for route-specific checks or mutations.

## Global Installers

Many packages expose `useX(app, options)` helpers:

- `useCors`
- `useHelmet`
- `useLogger`
- `useMetrics`
- `useOpenAPI`
- `useRateLimit`
- `useUpload`
- `useWebSockets`

These typically register hooks or routes on the app.

## Route Plugins

Route plugins are just async functions with the same `(req, res)` contract.

```ts
const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });
const limiter = createRateLimitPlugin({ maxRequests: 100, windowMs: 60_000 });

app.route({
  method: 'POST',
  path: '/api/jobs',
  plugins: [requireAuth, limiter],
  handler: async (_req, res) => {
    res.send({ ok: true });
  },
});
```

## Group Inheritance

Group-level plugins help you scope behavior cleanly:

```ts
app.group('/api/private', { plugins: [requireAuth] }, (group) => {
  group.route({
    method: 'GET',
    path: '/me',
    handler: async (req, res) => res.send({ id: req.user?.id }),
  });
});
```

## Hook Order

At a high level:

1. `onRequest`
2. route match
3. `onPreHandler`
4. route plugins
5. validation
6. route handler
7. `onPostHandler`
8. `onError` when an error is thrown

## Recommended Pattern

- install broad concerns globally
- keep auth, per-route limits, and focused checks as route plugins
- use groups to avoid duplication
