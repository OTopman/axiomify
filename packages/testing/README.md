# @axiomify/testing

[![npm version](https://img.shields.io/npm/v/@axiomify/testing.svg)](https://npmjs.com/package/@axiomify/testing)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Inject-style testing for Axiomify apps — no sockets, no ports, no adapter. Requests dispatch through `app.handle()`, the exact entry point production adapters use, so hooks, validation, serialization and error semantics behave identically to a live server.

## Install

```bash
npm install --save-dev @axiomify/testing
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { createTestClient } from '@axiomify/testing';

const app = new Axiomify();
app.route({
  method: 'POST',
  path: '/users',
  handler: async (req, res) => res.status(201).send({ id: 'usr_1' }),
});

const client = createTestClient(app);
const res = await client.post('/users', { body: { name: 'Ada' } });

expect(res.statusCode).toBe(201);
expect(res.json()).toMatchObject({ status: 'success' });
expect(res.data).toEqual({ id: 'usr_1' }); // raw value passed to res.send()
```

## Making requests

`client.inject(options)` is the primitive; `get` / `post` / `put` / `patch` / `delete` / `head` / `options` are convenience wrappers that take `(url, options)`.

| Option      | Type                                 | Default       | Description                                                                                                    |
| ----------- | ------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------- |
| `url`       | `string`                             | —             | Path with optional query string (`/users?limit=5`).                                                            |
| `method`    | `HttpMethod`                         | `'GET'`       | Only on `inject()`.                                                                                            |
| `query`     | `Record<string, value \| value[]>`   | —             | Merged with the query string in `url`; arrays produce repeated keys.                                           |
| `headers`   | `Record<string, string \| string[]>` | —             | Names are lowercased before dispatch.                                                                          |
| `cookies`   | `Record<string, string>`             | —             | Serialized into the `Cookie` header (values URI-encoded when needed).                                          |
| `body`      | `unknown`                            | —             | Objects/arrays are auto-JSON-encoded with `content-type: application/json`; strings and Buffers pass verbatim. |
| `state`     | `Record<string, unknown>`            | —             | Pre-populated into `req.state` before dispatch (e.g. a fake authenticated user).                               |
| `ip`        | `string`                             | `'127.0.0.1'` | What handlers see via `req.ip`.                                                                                |
| `timeoutMs` | `number`                             | `5000`        | Rejects with a helpful error if the handler never responds.                                                    |

Per-client defaults via `createTestClient(app, { ip, state, timeoutMs })`, or chainably:

```typescript
const asAdmin = client
  .withState('user', { id: 1, role: 'admin' })
  .withIp('10.0.0.7');
```

## Reading responses

`inject()` resolves with a `TestResponse`:

- `statusCode` — final HTTP status.
- `headers` — lowercase header map; `set-cookie` is always a `string[]` (never folded).
- `body` — raw response body string.
- `json<T>()` — parsed JSON body (throws with the status, content-type and a body excerpt on parse failure).
- `data` — the raw value the handler passed to `res.send()`, before the serializer envelope.
- `cookies` — structured parse of every `Set-Cookie` line (`name`, `value`, `path`, `expires`, `maxAge`, `httpOnly`, `secure`, `sameSite`, …).
- `sseEvents` — events captured from `res.sseSend()` (`{ data, event? }`); `body` shows the framed wire text.
- Streaming responses (`res.stream()`) are fully captured before `inject()` resolves; a stream error is surfaced on `streamError`.

The app's serializer is applied exactly like the native adapter applies it, so the captured payload envelope is byte-identical to production. HEAD responses suppress the body; CR/LF in header values throws (same response-splitting guard as `@axiomify/native`).

## Asserting against route schemas

`expectValidResponse` Zod-parses `res.data` against the `schema.response` declared on the registered route (single schema or per-status record) and throws a readable error listing every issue:

```typescript
import { expectValidResponse, getRoute } from '@axiomify/testing';

const res = await client.get('/users/42');
expectValidResponse(app, res, { method: 'GET', path: '/users/:id' });

getRoute(app, 'GET', '/users/42'); // → the RouteDefinition that would serve it
```

`getRoute` matches the literal registered path first (`/users/:id`), then falls back to router resolution so concrete paths resolve too.

## Exports

`createTestClient`, `TestClient`, `TestRequest`, `TestResponse`, `expectValidResponse`, `getRoute`, `parseSetCookie`, plus the types `InjectOptions`, `InjectVerbOptions`, `TestClientOptions`, `CapturedSseEvent`, `ParsedSetCookie`, `ValidatableResponse`.
