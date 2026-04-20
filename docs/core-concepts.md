# Core Concepts

## The Model

Axiomify centers everything around one `Axiomify` instance:

- routes
- validation
- hooks
- route plugins
- serialization

Adapters only translate between a real server and the core engine.

## Routes

Routes are registered with `app.route(...)`.

Each route can define:

- `method`
- `path`
- `schema`
- `plugins`
- `timeout`
- `handler`

Route schemas are Zod-driven and infer handler types for `req.body`, `req.query`, and `req.params`.

## Hooks

Global hooks run through the lifecycle engine:

- `onRequest`
- `onPreHandler`
- `onPostHandler`
- `onError`
- `onClose`

Use hooks for behavior that applies broadly across the app.

## Route Plugins

Route plugins are function handlers that run before validation and before the route handler.

```ts
const audit = async (req, res) => {
  req.state.auditStarted = Date.now();
};

app.route({
  method: 'GET',
  path: '/reports',
  plugins: [audit],
  handler: async (_req, res) => {
    res.send({ ok: true });
  },
});
```

Route plugins can short-circuit by sending a response.

## Grouping

Use `app.group(prefix, ...)` to reduce repetition.

You can also inherit shared route plugins:

```ts
app.group('/admin', { plugins: [requireAuth] }, (group) => {
  group.route({
    method: 'GET',
    path: '/users',
    handler: async (_req, res) => res.send({ ok: true }),
  });
});
```

## Serializer

Every adapter uses the core serializer to shape responses.

Override it with:

```ts
app.setSerializer((data, message, statusCode, isError) => ({
  ok: !isError,
  message,
  statusCode,
  data,
}));
```

## Utilities

Core also includes:

- `app.healthCheck(...)`
- `app.use(...)` for installer-style app plugins
- route-level timeout support
- request/response validation
