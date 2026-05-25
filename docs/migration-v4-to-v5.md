# Migration guide — Axiomify v4 → v5

This guide consolidates every breaking change between v4 and v5.0.0 into
a single page so you can migrate in one pass. Each item is keyed to the
relevant CHANGELOG entry; jump to [CHANGELOG.md](../CHANGELOG.md) for
the full context behind the change.

Headline: **almost every breaking change is mechanical.** Most are
find-and-replace renames; the two that touch runtime behaviour
(`X-Request-Id` opt-in, refresh-token rotation order) are documented in
detail below.

---

## TL;DR

For most apps, the migration is:

1. Add `app.enableRequestId()` after construction if you relied on
   automatic `X-Request-Id`.
2. `meta:` is the correct v5 field — no rename needed in v5. In **v6** it moves into `schema:`. See [migration-v5-to-v6.md](migration-v5-to-v6.md).
   the alias is kept through 5.x).
3. Change `useSwagger` imports to `useOpenAPI` if you somehow had the
   old name working (it was never actually shipped — docs were wrong).
4. Rename `routePrefix: '/docs'` → `prefix: '/docs'` on `useOpenAPI()`.
5. Tighten JWT secrets to ≥ 32 bytes (not chars).

That's the vast majority of apps. The rest of this document covers the
less-common changes plus the rationale for each.

---

## Breaking changes by package

### `@axiomify/core`

#### `X-Request-Id` is now opt-in

In v4 every `Axiomify` instance injected `X-Request-Id` automatically.
In v5 it is opt-in:

```ts
// v4
const app = new Axiomify();   // X-Request-Id injected on every response

// v5
const app = new Axiomify();
app.enableRequestId();        // explicit
```

**Why:** every app paid the per-request closure allocation cost,
including those that never needed request tracing. The default is now
zero cost; tracing is one line away when you want it.

#### `setSerializer` is sync-only, single-argument

The 4.x positional 5-arg serializer form was deprecated through 4.x with
a runtime warning. **v5 removes it**: `makeSerialize()` throws at
adapter-construction time on multi-arg functions:

```ts
// v4 — removed in 5.0
app.setSerializer((data, message, statusCode, isError, req) => ({ data, ok: !isError }));

// v5
app.setSerializer(({ data, message, statusCode, isError, req }) => ({ data, ok: !isError }));
```

Async serializers also now throw at construction (they'd corrupt every
response body via `JSON.stringify([object Promise])`):

```ts
// Will throw in 5.0
app.setSerializer(async ({ data }) => ({ data }));
```

Do async work in an `onPostHandler` hook or in the route handler itself.

#### `setSerializer` is locked after adapter construction

You can no longer swap the serializer after a `NativeAdapter` is built —
the adapter pre-builds cached 404/405/413/500 envelopes from the
configured serializer, and a late swap would produce inconsistent shapes:

```ts
// Throws in 5.0
const adapter = new NativeAdapter(app);
app.setSerializer(/* ... */);   // Error: adapter already locked
```

Call `setSerializer` before adapter construction.

#### `AppPlugin` type alias removed

```ts
// v4 (removed in 5.0)
const myPlugin: AppPlugin = (app) => { /* ... */ };

// v5
const myPlugin: AppConfigurator = (app) => { /* ... */ };
// or drop the annotation entirely — 1-arg functions are inferred.
```

The 1-arg runtime shape still works identically. Only the named TypeScript
type is gone.

#### `route.meta` — stable in v5, removed in v6

In v5 the `meta:` field (type `RouteMeta`) is the dedicated location for
OpenAPI metadata (`tags`, `summary`, `description`, `security`).

```ts
app.route({ method: 'GET', path: '/u', meta: { tags: ['U'], summary: 'Get user' }, handler });
```

In **v6**, `meta:` is removed and its fields move into `schema:` with
full OAS 3.1.0 coverage. See [migration-v5-to-v6.md](migration-v5-to-v6.md).

The `RouteMeta` type is available through v5. It is removed in v6.


#### `app.lockRoutes` requires a token

Was advisory in 4.x, token-gated in 5.x so user code can't accidentally
lock routes:

```ts
// v4
app.lockRoutes('@my/adapter');

// v5
import { ADAPTER_LOCK_TOKEN } from '@axiomify/core';
app.lockRoutes(ADAPTER_LOCK_TOKEN, '@my/adapter');
```

This is adapter-author surface — most apps never call this directly.

#### Hook arrays are snapshotted before iteration

If a hook called `app.addHook(type, ...)` of its own type during
execution, the added hook used to run for the *current* request. In v5
the array is snapshotted before iteration, so added hooks take effect
on the *next* request. This matches Express / Fastify / Koa convention.

**Action:** none for most apps. Code that relied on the old in-flight
mutation behaviour (rare) needs to defer registration to startup.

### `@axiomify/native`

#### `listenClustered()` is Linux-only by default

`SO_REUSEPORT` is a Linux kernel feature. On macOS and Windows, the
fallback is a userspace L4 TCP proxy that adds two event-loop hops per
byte — it defeats the perf rationale for using uWS at all.

v5 makes you opt in explicitly:

```ts
const adapter = new NativeAdapter(app, {
  port: 3000,
  // On macOS / Windows, this is REQUIRED for listenClustered():
  // allowUserspaceProxy: true,
});
adapter.listenClustered({ /* ... */ });
```

On non-Linux without the flag, `listenClustered()` throws at the call
site with a clear message. Single-process `listen()` is unaffected.

#### `gracefulShutdown` is now an adapter method

The unified entry point for HTTP + WebSocket drain lives on the adapter:

```ts
// v5 — recommended
const adapter = new NativeAdapter(app);
adapter.listen();
adapter.gracefulShutdown({
  onShutdown: async () => {
    await db.close();
    await logger.flush();
  },
  timeoutMs: 15_000,
});
```

The drain sequence: close the listen socket → wait for in-flight
requests to complete (capped by `timeoutMs`) → run `onShutdown` →
`process.exit(0)`. Time-out → `exit(1)`.

> **Do not** call `gracefulShutdown` from `@axiomify/core` against a
> `NativeAdapter` — that core helper is for Node's `http.Server`, not
> uWS. Use `adapter.gracefulShutdown()`.

#### Response header injection rejected at the API surface

`res.header(name, value)` now throws on CR / LF / NUL bytes in either
argument. This was a real response-splitting foothold in 4.x:

```ts
// Throws in 5.0
res.header('X-Foo', 'bar\r\nSet-Cookie: pwned=1');
```

If you build header values from user input, strip control characters
upstream OR catch the throw — but you almost certainly want to fix the
input sanitisation.

#### Multi-value request headers preserved as arrays

`req.headers['accept']` (and any repeated header) is now `string[]`
when uWS reports the same name twice. Previously the last value won
silently — a real auth-bypass risk if downstream plugins trusted the
last `Authorization`. The public type `AxiomifyRequest.headers` was
already `Record<string, string | string[] | undefined>`; the adapter now
matches.

**Action:** code that did `const ct = req.headers['content-type']` and
expected a string may need `Array.isArray(ct) ? ct[0] : ct`.

#### `405 Method Not Allowed` returned instead of `404`

Requests to a registered path with an unregistered method now return
`405` with an `Allow` header listing supported methods (RFC 9110
§15.5.6). v4 returned `404`.

**Action:** most clients handle this transparently. If you have any
404-handling code that catches missing methods, switch to detecting 405.

#### Response stream backpressure caps

`res.stream()` and `res.sseSend()` now have hard per-response memory
caps: 8 MiB pending bytes for HTTP streams, 1 MiB for SSE. A slow
client triggers `readable.destroy()` (stream) or `raw.end()` (SSE)
instead of unbounded heap growth.

EventSource clients reconnect automatically with `Last-Event-ID`; HTTP
streamers see a closed connection.

**Action:** none unless you intentionally relied on the unbounded
behaviour (you didn't).

### `@axiomify/auth`

#### JWT secret minimum is now in **bytes**

RFC 7518 §3.2 requires HS256 keys to be ≥ 256 bits. v4 measured the
secret in characters; a 32-char base64 string is 24 bytes / 192 bits —
below spec. v5 measures bytes:

```ts
// v5 throws in production / warns in development:
createAuthPlugin({ secret: 'short-secret' });   // < 32 bytes

// Generate a real one:
//   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

#### Refresh-token rotation order changed

v4 revoked the old `jti` **before** signing the new one. A transient
Redis blip between revoke and save would hard-log-out the user — the
old token destroyed, the new token never persisted.

v5 saves the new `jti` first, then revokes:

| Step | v4 | v5 |
|------|----|-----|
| 1 | verify old refresh | verify old refresh |
| 2 | check store.exists | check store.exists |
| 3 | **revoke old** | sign new tokens |
| 4 | sign new | **save new jti** |
| 5 | save new jti | respond to client |
| 6 | respond | revoke old (soft-fail) |

Store errors during the new-token save → **503** (was: silently 401 in
4.x). Store errors during the final revoke → swallowed (client already
has new credentials).

**Action:** if you have a `TokenStore` implementation, no code change.
The behaviour change is purely about which error surfaces when.

### `@axiomify/security`

#### Heuristic SQL injection detector removed

The regex pattern detector that shipped in 4.x was trivially bypassable
(comment insertion, case variation, URL encoding) and produced false
positives on legitimate JSON containing the strings `union select` /
`or 1=1`. Removed in 5.0:

```ts
// v4
useSecurity(app, { sqlInjectionProtection: true });  // would 403 on attack patterns

// v5
useSecurity(app, { sqlInjectionProtection: true });  // warns + no-op
```

The option is still accepted to avoid breaking existing config; it now
prints a deprecation warning at startup and has no runtime effect.

**Use parameterised queries at the database layer.** That's the only
real defence against SQLi.

#### NoSQL operator detector is now opt-in

Was `noSqlInjectionProtection: true` by default in 4.x; v5 defaults it
to `false`. Schema validation (Zod) stripping unexpected keys is the
real defence; this option is supplementary belt-and-braces for legacy
code without full schema coverage.

### `@axiomify/openapi`

#### `routePrefix` → `prefix`

In v5 both keys are accepted (`routePrefix` produces a runtime warning).
In **v6** `routePrefix` is fully removed.

```ts
// v4
useOpenAPI(app, { info, routePrefix: '/docs' });

// v5 — prefix preferred; routePrefix still works with a warning
useOpenAPI(app, { info, prefix: '/docs' });
```


#### `OpenApiGenerator` is now publicly exported

For client-codegen pipelines you can now `import { OpenApiGenerator }
from '@axiomify/openapi'` and generate the spec without mounting
Swagger UI. Used internally by `axiomify openapi`.

#### Full OAS 3.0.3 Operation Object coverage

Five fields gained route-level support: `operationId`, `deprecated`,
`externalDocs`, `servers`, `callbacks`. Plus two helpers for the
schema-derived sections: `requestBodyDescription` and
`responseDescriptions`. Strict additions — no behaviour change for
existing route definitions.

### `@axiomify/rate-limit`

#### Redis client argument shape is cached after first call

Was probed every request in 4.x (try object-form → catch → variadic),
which V8 deopt'd around the throw. Now probed once and cached. No API
change; pure perf win.

---

## Tooling — `@axiomify/cli`

Three new commands gained in 5.0:

| Command | Purpose |
|---|---|
| `axiomify openapi [entry]` | Generate the OpenAPI spec to stdout / file |
| `axiomify check [entry]` | Static production-readiness audit |
| `axiomify doctor` | Diagnose the host environment |

The `axiomify routes` output was overhauled: Unicode-bordered table,
colour-coded methods, WebSocket routes shown alongside HTTP routes
(previously omitted), with `--json` / `--method` / `--filter` / `--sort`
flags.

Removed flags that never existed in shipped code despite appearing in
older docs: `dev --port`, `dev --debug`, `build --minify`, `build --sourcemap`.

---

## Catch with `axiomify check`

Run the static auditor against your migrated app before deploying:

```bash
npx axiomify check
```

It flags routes still using deprecated `meta:`, missing
`enableRequestId()`, missing response schemas, environment-variable
references that aren't actually set, and several other migration smells.
Exit code 1 on any fail — wire into CI to gate deploys.

---

## Where to read more

- [CHANGELOG.md](../CHANGELOG.md) — the authoritative version history.
- [docs/packages/openapi.md](./packages/openapi.md) — `openapi:` field reference and per-operation metadata.
- [docs/packages/native.md](./packages/native.md) — `gracefulShutdown`, `allowUserspaceProxy`, header-injection guard.
- [docs/packages/auth.md](./packages/auth.md) — refresh-token rotation flow with 503 distinction.
- [docs/packages/cli.md](./packages/cli.md) — full reference for every CLI command and flag.
