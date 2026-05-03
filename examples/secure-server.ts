/**
 * Secure Axiomify server example.
 *
 * Demonstrates the full security plugin stack:
 * - Helmet security headers
 * - CORS with allowlist
 * - Rate limiting (Redis-backed)
 * - JWT authentication with refresh tokens and revocation
 * - Input sanitization / XSS protection
 * - Request fingerprinting
 */
import { Axiomify } from '@axiomify/core';
import {
  createAuthPlugin,
  createRefreshHandler,
  getAuthUser,
  MemoryTokenStore,
} from '@axiomify/auth';
import { useCors } from '@axiomify/cors';
import { FastifyAdapter } from '@axiomify/fastify';
import { useFingerprint } from '@axiomify/fingerprint';
import { useHelmet } from '@axiomify/helmet';
import { createRateLimitPlugin, MemoryStore } from '@axiomify/rate-limit';
import { useSecurity } from '@axiomify/security';
import { z } from 'zod';

const app = new Axiomify();

// Security headers (CSP, HSTS, X-Frame-Options, etc.)
useHelmet(app, { hsts: { maxAge: 31536000, includeSubDomains: true } });

// CORS
useCors(app, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
});

// XSS, HPP, prototype pollution, SQL/NoSQL injection heuristics
useSecurity(app, { xssProtection: true, hppProtection: true });

// Request fingerprinting for bot detection
useFingerprint(app);

// Auth
const tokenStore = new MemoryTokenStore(); // use RedisStore in production
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET ?? 'dev-secret-min-32-chars-xxxxxxxxxxxxxxx',
  store: tokenStore, // enables immediate access token revocation
});
const refreshHandler = createRefreshHandler({
  secret: process.env.JWT_SECRET ?? 'dev-secret-min-32-chars-xxxxxxxxxxxxxxx',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-min-32-chars-xxx',
  store: tokenStore,
});

// Rate limiting
const authLimiter = createRateLimitPlugin({
  store: new MemoryStore(),
  max: 5,
  windowMs: 60_000,
  allowMemoryStoreInProduction: true,
});

// Routes
app.route({
  method: 'POST',
  path: '/auth/refresh',
  plugins: [authLimiter],
  handler: refreshHandler,
});

app.route({
  method: 'GET',
  path: '/me',
  plugins: [requireAuth],
  handler: async (req, res) => {
    const user = getAuthUser(req);
    res.send({ id: user!.id });
  },
});

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

const adapter = new FastifyAdapter(app, { workers: 4 });

// Single process: await adapter.listen(3000);
adapter.listenClustered(3000, {
  onWorkerReady: () => console.log(`[${process.pid}] Secure server on :3000`),
  onPrimary: (pids) => console.log('Workers:', pids),
});
