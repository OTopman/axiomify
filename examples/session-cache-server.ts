/**
 * Session + cache + compression example.
 *
 * Demonstrates the stateful/performance plugin stack:
 * - Cookie sessions (`@axiomify/session`): login with `session.regenerate()`
 *   fixation defence, a /me route, logout via `session.destroy()`
 * - Response caching (`@axiomify/cache`): `cached()` with stale-while-revalidate,
 *   automatic ETag + 304 conditional GETs
 * - Response compression (`@axiomify/compress`): brotli/gzip/deflate
 * - Group-scoped hooks (`group.addHook`): an /admin group with an auth check
 *   and an audit trail that never fire outside the group
 * - Direct cookie access via `res.cookie()` / `req.cookies`
 */
import { Axiomify, ForbiddenError, UnauthorizedError, z } from '@axiomify/core';
import { cached, useCache } from '@axiomify/cache';
import { useCompress } from '@axiomify/compress';
import { NativeAdapter } from '@axiomify/native';
import { getSession, MemorySessionStore, useSession } from '@axiomify/session';

export const app = new Axiomify();

// Compress responses >= 1 KiB (brotli preferred, gzip/deflate fallback).
useCompress(app);

// Response cache: routes opt in via `cached()` below. Every GET/HEAD response
// also gets a weak ETag, and a request whose If-None-Match matches is answered
// with 304 and an empty body — no handler run, no bytes on the wire.
useCache(app, { defaultTtl: 30 });

// Cookie sessions. MemorySessionStore is per-process — use RedisSessionStore
// for clustered/multi-instance deployments.
const sessionStore = new MemorySessionStore();
useSession(app, {
  // Dev fallback only (secrets must be >= 32 bytes). Set SESSION_SECRET in
  // any real deployment — a known constant lets anyone forge session cookies.
  secret: process.env.SESSION_SECRET ?? 'dev-only-insecure-session-secret-0123456789',
  store: sessionStore,
  cookie: { maxAge: 86_400, sameSite: 'lax' },
});

// Login: authenticate, then regenerate the session ID so a pre-login cookie
// planted by an attacker can't be promoted to an authenticated one (fixation).
app.route({
  method: 'POST',
  path: '/login',
  schema: {
    body: z.object({
      username: z.string().min(1),
      password: z.string().min(8),
    }),
  },
  handler: async (req, res) => {
    // Demo credential check — replace with a real user lookup.
    const { username } = req.body;
    const session = getSession(req);
    await session.regenerate();
    session.username = username;
    session.role = username === 'admin' ? 'admin' : 'user';
    res.send({ username, role: session.role }, 'Signed in');
  },
});

app.route({
  method: 'GET',
  path: '/me',
  handler: async (req, res) => {
    const session = getSession(req);
    if (!session.username) throw new UnauthorizedError('Not signed in');
    res.send({ username: session.username, role: session.role });
  },
});

app.route({
  method: 'POST',
  path: '/logout',
  handler: async (req, res) => {
    // Deletes the store entry, expires the cookie and freezes the session.
    await getSession(req).destroy();
    res.send({ ok: true }, 'Signed out');
  },
});

// Public, cacheable data. First hit: X-Cache: MISS (handler runs, entry
// stored). Within 60s: HIT straight from the store. Between 60s and 360s:
// STALE is served instantly while a single request refreshes in background.
app.route({
  method: 'GET',
  path: '/catalog',
  plugins: [cached({ ttl: 60, swr: 300 })],
  handler: async (_req, res) => {
    res.send({
      products: [
        { id: 'p1', name: 'Keyboard', price: 89 },
        { id: 'p2', name: 'Trackball', price: 129 },
      ],
      generatedAt: new Date().toISOString(),
    });
  },
});

// Plain cookies, no session: toggle a theme preference. `req.cookies` is
// lazily parsed from the Cookie header; `res.cookie()` queues one Set-Cookie
// line per call (implemented by all first-party adapters).
app.route({
  method: 'POST',
  path: '/prefs/theme',
  handler: async (req, res) => {
    const next = req.cookies?.theme === 'dark' ? 'light' : 'dark';
    res.cookie!('theme', next, { maxAge: 31_536_000, sameSite: 'lax' });
    res.send({ theme: next });
  },
});

// Admin surface with group-scoped hooks: unlike app.addHook(), these never
// fire for traffic outside /admin, so the auth check can't leak into the
// public routes above.
app.group('/admin', (admin) => {
  admin.addHook('onRequest', (req) => {
    if (getSession(req).role !== 'admin') {
      throw new ForbiddenError('Admins only');
    }
  });

  // onPostHandler is scoped exactly: only routes registered through this
  // group (including nested groups) produce an audit line.
  admin.addHook('onPostHandler', (req, res, { route }) => {
    console.log(
      `[audit] ${String(getSession(req).username)} ${req.method} ${route.path} -> ${res.statusCode}`,
    );
  });

  admin.route({
    method: 'GET',
    path: '/stats',
    handler: async (_req, res) => {
      res.send({ activeSessions: sessionStore.size, uptime: process.uptime() });
    },
  });
});

const adapter = new NativeAdapter(app, { port: 3000 });

if (require.main === module) {
  adapter.listen((port) => console.log('Session/cache server on :' + port));
}
