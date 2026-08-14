# Contract testing

Axiomify’s route schemas are executable API contracts. Use the three layers
together: response assertions during unit tests, route-surface snapshots in
CI, and Studio checks while exploring an application.

## 1. Assert responses in application tests

Declare a response schema, exercise the route with the inject client, then
assert the raw handler value against the contract:

```ts
import { z } from 'zod';
import { Axiomify } from '@axiomify/core';
import { createTestClient, expectValidResponse } from '@axiomify/testing';

const app = new Axiomify();
app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  handler: (req, res) => res.send({ id: req.params.id, name: 'Ada' }),
});

const client = createTestClient(app);
const response = await client.get('/users/42');

expect(response.statusCode).toBe(200);
expectValidResponse(app, response, {
  method: 'GET',
  path: '/users/:id',
});
```

`expectValidResponse` supports one response schema or a status-code map. It
throws with the exact Zod violations when an implementation drifts.

## 2. Gate API changes in CI

Commit a route-surface baseline and compare changes on every pull request:

```bash
# Refresh intentionally, after reviewing the route change.
axiomify routes --snapshot routes-baseline.json

# Fail for removed routes, changed methods, or narrowed input schemas.
axiomify routes --diff routes-baseline.json

# Also treat response-schema changes as breaking.
axiomify routes --diff routes-baseline.json --strict-response
```

The snapshot contains canonical schema hashes, so formatting and registration
order do not create noise. Use `--allow-breaking` only for an intentional,
communicated compatibility break.

## 3. Explore contracts in Studio

`axiomify studio` can generate schema-shaped requests and report response
contract violations interactively. This is useful for finding coverage gaps,
but automated tests and the route-surface CI gate remain the release boundary.

## Recommended policy

- Every public mutation route has body and response schemas.
- Every expected non-2xx response has its own response schema.
- New or changed routes include a focused response-contract test.
- CI runs `axiomify routes --diff routes-baseline.json --strict-response`.
