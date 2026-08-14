# @axiomify/session

Cookie sessions for Axiomify — HMAC-SHA256-signed cookies with secret rotation, Proxy-based dirty tracking, pluggable stores and fixation defence. Zero dependencies.

## Install

```bash
npm install @axiomify/session
```

## Exports

| Export                | Kind                     | Description                                                                                                                                                          |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useSession`          | `(app, options) => void` | Register cookie sessions.                                                                                                                                            |
| `createSessionModule` | `(options) => AppModule` | Same as `useSession`, as a module (e.g. to declare as a dependency of another module). Provides the store in DI as `'sessionStore'`.                                 |
| `getSession`          | `(req) => Session`       | Access the request's session; throws if the plugin isn't registered.                                                                                                 |
| `MemorySessionStore`  | class                    | Map + TTL, per-process.                                                                                                                                              |
| `RedisSessionStore`   | class                    | BYO `ioredis` / `redis@4` client.                                                                                                                                    |
| Types                 | —                        | `Session`, `SessionOptions`, `SessionCookieOptions`, `SessionStore`, `SessionRecord`, `SessionRedisClient`, `MemorySessionStoreOptions`, `RedisSessionStoreOptions`. |

## Options (`SessionOptions`)

| Option              | Type                   | Default                       | Description                                                                                                                                                                           |
| ------------------- | ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret`            | `string \| string[]`   | — (required)                  | Signing secret(s). Array = rotation: cookies signed with `secret[0]`, verified against all. Every entry must be ≥ 32 UTF-8 bytes (256 bits) — throws at registration otherwise.       |
| `cookieName`        | `string`               | `'axiomify.sid'`              | Validated as an RFC 6265 token at boot.                                                                                                                                               |
| `cookie`            | `SessionCookieOptions` | `{}`                          | Effective defaults: `HttpOnly; SameSite=Lax; Path=/` (`Path` is set explicitly so `destroy()`'s clear-cookie always matches). Omit `maxAge` for a browser-session cookie.             |
| `store`             | `SessionStore`         | `new MemorySessionStore()`    | Warns at boot when defaulted under `NODE_ENV=production`.                                                                                                                             |
| `rolling`           | `boolean`              | `false`                       | Re-issue the cookie and slide the store TTL every request.                                                                                                                            |
| `saveUninitialized` | `boolean`              | `false`                       | Persist never-written new sessions. Off: untouched anonymous sessions cause no store write and no `Set-Cookie`.                                                                       |
| `idleTimeout`       | `number` (s)           | `cookie.maxAge`, else `86400` | Store TTL — idle expiry.                                                                                                                                                              |
| `absoluteTimeout`   | `number` (s)           | —                             | Hard lifetime from creation (`createdAt` travels in the stored record), enforced even under rolling expiry. An absolutely-expired session is destroyed and replaced with a fresh one. |

`SessionCookieOptions` is core's `CookieOptions` with `secure?: boolean | 'auto'`. `'auto'` sets `Secure` when the first `x-forwarded-proto` value is `https` — it trusts that header, so only use it behind a proxy that controls it.

## The `Session` object

`getSession(req)` returns a Proxy. Arbitrary string keys are session data; reserved names (`id`, `isNew`, `destroy`, `regenerate`, `touch`, `save`) throw on assignment.

| Member         | Description                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | 128-bit cryptographically random, base64url (22 chars).                                                                                                                     |
| `isNew`        | True until first persisted.                                                                                                                                                 |
| `destroy()`    | Delete the store entry, emit an expiring clear-cookie, freeze the session (further writes throw).                                                                           |
| `regenerate()` | New ID + `createdAt`, keeps the data, destroys the old store entry, re-queues the cookie. Fixation defence — call on login/privilege change. Throws on a destroyed session. |
| `touch()`      | Flag a TTL refresh (store `touch` + browser-side expiry re-issue) without data changes.                                                                                     |
| `save()`       | Persist immediately (also flips `isNew` off). Throws on a destroyed session.                                                                                                |
| `toJSON()`     | Shallow copy of the data.                                                                                                                                                   |

### Dirty tracking (Proxy semantics)

Assignments and deletes on the session — and on **nested plain objects/arrays**, which are returned as recursive tracking proxies (identity-stable per session via WeakMap) — mark the session dirty and, if needed, queue the cookie synchronously. A Proxy is used instead of an end-of-request snapshot diff because (1) the lazy `Set-Cookie` decision must happen at the moment of the first write while headers are still open, and (2) a snapshot diff pays a deep clone + compare on every request, including read-only ones.

**Caveat:** non-plain values (Date, Map, Buffer, class instances) are returned raw — in-place mutation of those is invisible to the tracker. Reassign the key or call `touch()` / `await save()`.

### Cookie strategy (eager)

By `onPostHandler` the response is usually flushed, so `Set-Cookie` must be queued while headers are writable:

- new session + `saveUninitialized` → cookie during `onRequest`;
- existing session + `rolling` → re-issued during `onRequest` (slides browser expiry);
- new session otherwise → **lazy**: the first data write queues it synchronously.

A session write after `res.send()` cannot deliver its cookie — the plugin warns once and the session is orphaned. Write to the session before sending the response.

### Persistence lifecycle

Persistence runs from `onPostHandler` (happy path) with an `onClose` safety net (handler errors and unmatched routes bypass `onPostHandler`); the two can never double-save. Dirty sessions (or new ones under `saveUninitialized`) are written with the idle TTL; merely touched/rolling sessions get a store `touch`. Tampered signatures and unknown IDs fall through to a fresh anonymous session — a client-supplied ID is never trusted. Store `get` failures propagate (fail closed) rather than silently logging users out during an outage.

## Stores

### `SessionStore` interface

```ts
interface SessionStore {
  get(id: string): Promise<SessionRecord | null | undefined>; // miss → null/undefined
  set(id: string, data: SessionRecord, ttlSeconds: number): Promise<void>; // (re)write + reset TTL
  destroy(id: string): Promise<void>; // missing id = no-op
  touch(id: string, ttlSeconds: number): Promise<void>; // refresh TTL only
}
// SessionRecord = { data: Record<string, unknown>; createdAt: number }
```

### `MemorySessionStore(options?)`

Per-process Map + TTL. `maxSessions` (default 100 000) caps forced-session attacks — expired entries are swept first, then oldest-written evicted. Lazy expiry on `get` plus an `unref`'d background sweep (`sweepIntervalMs`, default 60 000). Records are `structuredClone`d on read and write, so session data must be structured-cloneable (it must be JSON-serialisable anyway for Redis parity). `size` and `close()` are exposed for tests/shutdown.

### `RedisSessionStore(client, options?)`

Bring your own connected client — `ioredis` and `redis@4` are duck-typed via `get`/`set`/`del`/`expire` (`SessionRedisClient`). Records are JSON under `<prefix><id>` (default prefix `axiomify:sess:`) written with `SET … EX`; `touch` maps to `EXPIRE`. The `set`+TTL argument shape (variadic vs options object) is probed once and cached. Corrupt payloads read as misses, not 500s.

## Security posture

- HMAC-SHA256-signed cookies over ≥ 32-byte secrets; rotation without mass logout via the `secret[]` form.
- `HttpOnly; SameSite=Lax; Path=/` defaults; `secure: 'auto'` for TLS-terminating proxies.
- `regenerate()` for fixation defence; `absoluteTimeout` bounds stolen-cookie value under rolling expiry.
- IDs are 128-bit CSPRNG; invalid/tampered cookies always yield a fresh anonymous session.
