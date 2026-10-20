# Tenant-scoped routes

Resolve the authenticated tenant once, then require tenant context throughout
a route subtree and pass it explicitly to data access.

## When to use this

Use this when multiple customer accounts share one application process. Route
groups scope policy and middleware; database queries still need explicit tenant
filters and database-level isolation controls.

## Prerequisites

```bash
npm install @axiomify/core @axiomify/auth zod
```

## Implementation

```ts
import { Axiomify } from '@axiomify/core';
import { createAuthPlugin, getAuthUser } from '@axiomify/auth';

const app = new Axiomify();
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  algorithms: ['HS256'],
});

const requireTenant = (req: any, res: any) => {
  const tenantId = req.headers['x-tenant-id'];
  const user = getAuthUser(req);
  if (typeof tenantId !== 'string' || !user?.tenantIds?.includes(tenantId)) {
    res.status(403).send({ error: 'Tenant access denied' });
    return;
  }
  req.state.set('tenantId', tenantId);
};

app.group('/api', { plugins: [requireAuth, requireTenant] }, (api) => {
  api.route({
    method: 'GET',
    path: '/projects',
    handler: async (req, res) => {
      const tenantId = req.state.get('tenantId');
      const projects = await projectStore.listForTenant(String(tenantId));
      res.send(projects);
    },
  });
});
```

## Production notes

- Derive tenant membership from authenticated identity or a trusted mapping;
  never trust a tenant header on its own.
- Include the tenant predicate in every read, write, uniqueness constraint,
  cache key, background job, and object-storage path.
- Prefer database row-level security or equivalent defense in depth.
- Add tests proving one tenant cannot read or mutate another tenant's records.

## Verification

Exercise the route with a member token and tenant ID, then repeat with an
unrelated tenant ID and assert a forbidden response and zero cross-tenant data.
