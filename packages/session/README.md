# @axiomify/session

[![npm version](https://img.shields.io/npm/v/@axiomify/session.svg)](https://npmjs.com/package/@axiomify/session)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Cookie sessions for Axiomify — HMAC-SHA256-signed session cookies with secret rotation, automatic dirty tracking, pluggable stores (memory shipped, Redis via a BYO client) and fixation defence via `regenerate()`. Zero dependencies.

## Install

```bash
npm install @axiomify/session
```

## Quick start

```typescript
import { useSession, getSession } from '@axiomify/session';

useSession(app, {
  secret: process.env.SESSION_SECRET!, // ≥ 32 bytes — enforced at boot
  cookie: { maxAge: 86_400, sameSite: 'lax' },
});

app.route({
  method: 'POST',
  path: '/login',
  handler: async (req, res) => {
    const session = getSession(req);
    await session.regenerate(); // new ID on privilege change (fixation defence)
    session.userId = user.id; // plain assignment — persisted automatically
    res.send({ ok: true });
  },
});
```

## Options

| Option              | Type                   | Default                     | Description                                                                                                                                                                           |
| ------------------- | ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret`            | `string \| string[]`   | — (required)                | HMAC-SHA256 signing secret(s). An array enables zero-downtime rotation: sign with `secret[0]`, verify against all. Every entry must be ≥ 32 bytes — throws at registration otherwise. |
| `cookieName`        | `string`               | `'axiomify.sid'`            | Must be an RFC 6265 token (validated at boot).                                                                                                                                        |
| `cookie`            | `SessionCookieOptions` | `{}`                        | Cookie attributes. Effective defaults: `HttpOnly; SameSite=Lax; Path=/`. `secure` also accepts `'auto'`. Omit `maxAge` for a browser-session cookie.                                  |
| `store`             | `SessionStore`         | `new MemorySessionStore()`  | Storage backend (warns at boot when the memory store is used with `NODE_ENV=production`).                                                                                             |
| `rolling`           | `boolean`              | `false`                     | Re-issue the cookie and slide the store TTL on every request.                                                                                                                         |
| `saveUninitialized` | `boolean`              | `false`                     | Persist brand-new sessions that were never written to. Off by default: read-only anonymous traffic produces no store write and no `Set-Cookie`.                                       |
| `idleTimeout`       | `number` (seconds)     | `cookie.maxAge`, else 86400 | Store TTL — a session not seen for this long expires.                                                                                                                                 |
| `absoluteTimeout`   | `number` (seconds)     | —                           | Hard lifetime from session creation, enforced even under rolling expiry (limits the value of a stolen cookie).                                                                        |

`secure: 'auto'` sets the `Secure` flag per-request when `x-forwarded-proto` resolves to `https`. **Only use it behind a proxy that strips or overwrites that header** — a client talking directly to Node can forge it.

## The session object

`getSession(req)` returns the per-request session. Arbitrary properties are session data; `id`, `isNew`, `destroy`, `regenerate`, `touch` and `save` are reserved (assigning to them throws).

- `session.destroy()` — delete the store entry, expire the cookie, freeze the session.
- `session.regenerate()` — issue a new ID while keeping the data; call it on login/privilege change.
- `session.touch()` — mark for a TTL refresh without changing data.
- `session.save()` — persist immediately instead of at end of request.

### Dirty tracking

The session is a Proxy: any assignment (`session.userId = 42`) or delete marks it dirty, and dirty sessions persist automatically at end of request (with an `onClose` safety net that also covers handler errors and 404s). Nested mutation is tracked too — reads of plain objects/arrays return recursive tracking proxies, so `session.user.name = 'x'` and `session.items.push(y)` count as writes.

**Caveat:** non-plain values (Date, Map, Buffer, class instances) are returned raw — mutating those in place is invisible. Reassign the key, or call `session.touch()` / `await session.save()`.

### Cookie timing

The `Set-Cookie` header is queued **eagerly, while response headers are still writable**: at `onRequest` for `saveUninitialized`/`rolling` sessions, or synchronously at the first data write otherwise. Waiting until after the handler would be too late — the response is usually already flushed. Consequence: write to the session **before** `res.send()`; a later write cannot deliver its cookie (warned once) and the session is orphaned.

## Stores

```typescript
import Redis from 'ioredis';
import { RedisSessionStore } from '@axiomify/session';

useSession(app, {
  secret: process.env.SESSION_SECRET!,
  store: new RedisSessionStore(new Redis(), { prefix: 'axiomify:sess:' }),
});
```

- **`MemorySessionStore`** — Map + TTL, per-process. Capped at `maxSessions` (default 100 000, oldest-written evicted first), background sweep on an `unref`'d timer, `structuredClone` isolation on read/write. `close()` stops the timer.
- **`RedisSessionStore`** — bring your own connected client; `ioredis` and `redis@4` are both duck-typed (the `set`+TTL argument shape is probed once and cached). Records are JSON under `<prefix><id>` with `SET … EX`; `touch` maps to `EXPIRE`.
- **Custom** — implement `SessionStore` (`get` / `set` / `destroy` / `touch`, all async). The store is also provided in DI as `'sessionStore'`.

## Security posture

- Session IDs are 128-bit cryptographically random; the cookie carries `HMAC-SHA256(id, secret)` — a tampered or unsigned cookie yields a fresh anonymous session, never a trusted ID.
- Secrets must be ≥ 32 bytes (256 bits); rotation via the array form avoids mass logout when rotating.
- Cookies default to `HttpOnly; SameSite=Lax; Path=/`.
- Store `get` errors propagate (fail closed) — a store outage surfaces as errors rather than silently logging everyone out.
- `absoluteTimeout` bounds rolling sessions; `regenerate()` defends against session fixation.
