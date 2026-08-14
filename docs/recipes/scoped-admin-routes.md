# Scoped administration routes

Protect a route subtree without accidentally applying administration policy to
public endpoints or sibling route groups.

## Prerequisites

```bash
npm install @axiomify/core @axiomify/auth jsonwebtoken
```

## Implementation

Use a route group for the URL boundary and `group.use()` for middleware that
must remain inside that boundary. Middleware applies to routes declared after
it, including nested groups.

```ts
import { Axiomify } from '@axiomify/core';
import { createAuthPlugin, getAuthUser } from '@axiomify/auth';

const app = new Axiomify();
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  algorithms: ['HS256'],
});

const requireAdmin = (req, res) => {
  const user = getAuthUser(req);
  if (user?.role !== 'admin') {
    res.status(403).send(null, 'Administrator access required');
  }
};

app.route({
  method: 'GET',
  path: '/health',
  handler: (_req, res) => res.send({ status: 'ok' }),
});

app.group('/admin', (admin) => {
  admin.use(requireAuth);
  admin.use(requireAdmin);

  admin.route({
    method: 'GET',
    path: '/users',
    handler: async (_req, res) => res.send(await users.list()),
  });

  admin.group('/audit', (audit) => {
    audit.route({
      method: 'GET',
      path: '/events',
      handler: async (_req, res) => res.send(await auditStore.list()),
    });
  });
});
```

## Production notes

- Pin JWT algorithms and use a secret of at least 32 bytes.
- Ensure the role check returns immediately after sending a response if later
  middleware may have side effects.
- Add rate limiting to sensitive endpoints and record an audit event for
  privileged writes.

## Verification

Test `/health` without a token, `/admin/users` with a regular user token, and
the same route with an admin token. Only the final request should succeed.
