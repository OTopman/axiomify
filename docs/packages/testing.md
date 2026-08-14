# @axiomify/testing

Inject-style test client for Axiomify apps — no sockets, no ports, no adapter. Requests dispatch through `app.handle()`, the same entry point production adapters use, so hooks, validation, serialization and error semantics match a live server exactly.

## Install

```bash
npm install --save-dev @axiomify/testing
```

## Exports

| Export                | Kind                                      | Description                                                                                                                                               |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTestClient`    | `(app, options?) => TestClient`           | Build a client with optional per-client defaults.                                                                                                         |
| `TestClient`          | class                                     | `inject()` + verb methods + `withState()` / `withIp()`.                                                                                                   |
| `TestResponse`        | class                                     | Capturing `AxiomifyResponse` returned by `inject()`.                                                                                                      |
| `TestRequest`         | class                                     | The `AxiomifyRequest` implementation `inject()` dispatches.                                                                                               |
| `expectValidResponse` | `(app, res, { method, path }) => unknown` | Assert `res.data` against the route's `schema.response`.                                                                                                  |
| `getRoute`            | `(app, method, path) => RouteDefinition?` | Look up a registered route (literal path, then router resolution).                                                                                        |
| `parseSetCookie`      | `(line) => ParsedSetCookie`               | Structured parse of one `Set-Cookie` header line.                                                                                                         |
| Types                 | —                                         | `InjectOptions`, `InjectVerbOptions`, `TestClientOptions`, `QueryValue`, `CapturedSseEvent`, `ParsedSetCookie`, `ValidatableResponse`, `TestRequestInit`. |

## `TestClient`

```ts
const client = createTestClient(app, {
  ip: '10.0.0.1',
  state: {},
  timeoutMs: 5000,
});

await client.inject({ method: 'PUT', url: '/items/1', body: { qty: 2 } });
await client.get('/items', { query: { tag: ['a', 'b'] } }); // → ?tag=a&tag=b
await client.post('/items', { body: { name: 'x' } });
// also: put, patch, delete, head, options
```

`withState(key, value)` and `withIp(ip)` return new clients (chainable, original unchanged) — e.g. pre-populate `req.state.user` to simulate an authenticated request without running the auth plugin.

### `InjectOptions`

| Option      | Type                                         | Default       | Notes                                                                                                                                                                             |
| ----------- | -------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`    | `HttpMethod`                                 | `'GET'`       | Verb methods set this for you.                                                                                                                                                    |
| `url`       | `string`                                     | —             | Path with optional query string.                                                                                                                                                  |
| `query`     | `Record<string, QueryValue \| QueryValue[]>` | —             | Merged with the `url` query string; arrays become repeated keys.                                                                                                                  |
| `headers`   | `Record<string, string \| string[]>`         | —             | Names lowercased before dispatch.                                                                                                                                                 |
| `cookies`   | `Record<string, string>`                     | —             | Serialized into the `Cookie` header; names must be RFC 6265 tokens (throws otherwise), values URI-encoded when needed. Appended to any existing `cookie` header.                  |
| `body`      | `unknown`                                    | —             | Objects/arrays auto-JSON with `content-type: application/json`; strings/Buffers verbatim (JSON strings parsed when the content-type says so). `content-length` set automatically. |
| `ip`        | `string`                                     | `'127.0.0.1'` | Seen via `req.ip`.                                                                                                                                                                |
| `state`     | `Record<string, unknown>`                    | —             | Merged over the client's default state into `req.state`.                                                                                                                          |
| `timeoutMs` | `number`                                     | `5000`        | Rejects with a message naming the route if the handler never calls `res.send()` / `res.sendRaw()` / `res.stream()` / `res.sseInit()`.                                             |

## `TestResponse`

| Member                              | Type                                 | Description                                                                                                                                  |
| ----------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `statusCode`                        | `number`                             | Final HTTP status.                                                                                                                           |
| `headers`                           | `Record<string, string \| string[]>` | Lowercase names; `set-cookie` is always `string[]` (RFC 6265 forbids folding).                                                               |
| `body`                              | `string`                             | Raw body. SSE responses show the framed `event:`/`data:` wire text.                                                                          |
| `json<T>()`                         | `T`                                  | Parsed JSON body; throws a rich error (status, content-type, body excerpt) on failure.                                                       |
| `data`                              | `unknown`                            | The raw value passed to `res.send()` — before the serializer envelope.                                                                       |
| `message`                           | `string \| undefined`                | The message passed to `res.send(data, message)`.                                                                                             |
| `payload`                           | `unknown`                            | Output of the app's serializer (the envelope object).                                                                                        |
| `cookies`                           | `ParsedSetCookie[]`                  | Structured parse of every `Set-Cookie` line (name, value, path, domain, expires, maxAge, httpOnly, secure, sameSite, partitioned, priority). |
| `sseEvents`                         | `CapturedSseEvent[]`                 | `{ data, event? }` per `res.sseSend()` call.                                                                                                 |
| `sseStarted`                        | `boolean`                            | True once `sseInit()` / first `sseSend()` ran. SSE responses stay open by design — `inject()` resolves when the handler returns.             |
| `sseHeartbeatMs`                    | `number \| undefined`                | The interval requested via `sseInit(ms)` — captured, never scheduled (no live timer in tests).                                               |
| `streamError`                       | `Error \| null`                      | Error emitted by a streamed readable, if any.                                                                                                |
| `completed` / `waitForCompletion()` | `boolean` / `Promise<void>`          | Body fully produced. `inject()` already awaits this for streamed and late responses.                                                         |

Fidelity guarantees:

- The app serializer is applied exactly like `NativeResponse.send()` — the captured payload envelope is byte-identical to production.
- `cookie()` / `clearCookie()` validate via core's `serializeCookie`, HEAD responses suppress the body (RFC 9110 §9.3.2), and CR/LF in header names/values or content types throws — the same response-splitting guard as `@axiomify/native`.
- `res.headersSent`, streaming capture and the dispatcher's `onClose` hook all behave as in the native adapter.

## Schema assertions

```ts
const res = await client.get('/users/42');
const parsed = expectValidResponse(app, res, {
  method: 'GET',
  path: '/users/:id',
});
```

`expectValidResponse` resolves the route (via `getRoute`), picks the declared `schema.response` — a single Zod schema or a per-status record (`{ 200: …, 404: … }`) keyed by `res.statusCode` — and `safeParse`s `res.data`. On mismatch it throws listing every Zod issue plus the received data; on success it returns the parsed (defaulted/coerced) data. Missing route, missing `schema.response`, or an undeclared status each throw a distinct, descriptive error.
