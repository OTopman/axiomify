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
import { NativeAdapter } from '@axiomify/native';
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
// Never fall back to a hardcoded secret — a copied example deployed without
// these env vars would otherwise sign tokens with a publicly known constant.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}
const requireAuth = createAuthPlugin({
  secret: requireEnv('JWT_SECRET'),
  store: tokenStore, // enables immediate access token revocation
});
const refreshHandler = createRefreshHandler({
  secret: requireEnv('JWT_SECRET'),
  refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
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

const adapter = new NativeAdapter(app, { port: 3000 });

// Single process: await adapter.listen();
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] Secure server on :3000`),
  onPrimary: (pids: number[]) => console.log('Workers:', pids),
});
