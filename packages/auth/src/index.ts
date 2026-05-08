import type {
  AxiomifyRequest,
  AxiomifyResponse,
  PluginHandler,
} from '@axiomify/core';
import { randomUUID } from 'crypto';
import type { Algorithm, JwtPayload, SignOptions, VerifyOptions } from 'jsonwebtoken';
import { sign, verify } from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  [key: string]: unknown;
}

export interface AuthOptions {
  secret: string;
  algorithms?: Algorithm[];
  getToken?: (req: AxiomifyRequest) => string | null;
  issuer?: string;
  audience?: string | string[];
  /**
   * Optional token store for access token revocation.
   *
   * When provided, `createAuthPlugin` calls `store.exists(jti)` on every
   * authenticated request. If `exists()` returns `false` (jti was revoked or
   * never saved), the request is rejected with 401.
   *
   * Use case: immediate logout. When a user logs out, call `store.revoke(jti)`
   * — all subsequent requests using that access token fail immediately without
   * waiting for the token to expire.
   *
   * ⚠️  Every authenticated request hits the store. Use Redis in production.
   * `MemoryTokenStore` is per-process and not shared across cluster workers.
   *
   * When using a store, you must call `store.save(jti, ttlSeconds)` when
   * issuing access tokens so they exist in the store before use.
   */
  store?: TokenStore;
}

export interface TokenStore {
  save(jti: string, ttlSeconds: number): Promise<void>;
  exists(jti: string): Promise<boolean>;
  revoke(jti: string): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, NodeJS.Timeout>();

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[axiomify/auth] MemoryTokenStore is per-process and not shared across ' +
          'multiple instances or workers. Revoked tokens are not propagated to other ' +
          'processes, making token revocation unreliable in multi-process deployments. ' +
          'Use a distributed store (e.g. Redis) for production.',
      );
    }
  }

  async save(jti: string, ttlSeconds: number): Promise<void> {
    await this.revoke(jti);

    // Node.js setTimeout max delay is 2,147,483,647ms (~24.9 days). Multiplying
    // a 30-day TTL (2,592,000s) by 1000 overflows signed 32-bit int, causing
    // the timer to fire immediately and delete the token the instant it is saved.
    // We cap the delay at the Node maximum. For production, use Redis which
    // handles arbitrary TTLs natively via PEXPIRE.
    const MAX_TIMEOUT_MS = 2_147_483_647;
    const delayMs = Math.min(ttlSeconds * 1000, MAX_TIMEOUT_MS);

    const timer = setTimeout(() => this.tokens.delete(jti), delayMs);
    timer.unref?.();
    this.tokens.set(jti, timer);
  }

  async exists(jti: string): Promise<boolean> {
    return this.tokens.has(jti);
  }

  async revoke(jti: string): Promise<void> {
    const timer = this.tokens.get(jti);
    if (timer) clearTimeout(timer);
    this.tokens.delete(jti);
  }
}

export interface RefreshOptions {
  secret: string;
  refreshSecret: string;
  accessTokenTtl?: number;
  refreshTokenTtl?: number;
  algorithms?: Algorithm[];
  issuer?: string;
  audience?: string | string[];
  /**
   * Optional token store for refresh-token revocation support.
   * Without a store, stolen refresh tokens cannot be revoked before expiry.
   */
  store?: TokenStore;
  /**
   * Optional rate-limit plugin reference for route wiring.
   * Apply it on your `/auth/refresh` route via `plugins: [rateLimitPlugin]`.
   */
  rateLimitPlugin?: PluginHandler;
}

const BLOCKED_ALGORITHMS = new Set(['none', 'NONE', 'None']);
function validateAlgorithms(algorithms: string[]): Algorithm[] {
  const safe = algorithms.filter((a) => !BLOCKED_ALGORITHMS.has(a)) as Algorithm[];
  if (safe.length === 0) throw new Error('[axiomify/auth] Every provided algorithm was rejected. The "none" algorithm is not permitted.');
  return safe;
}
function extractBearer(header: string): string | null {
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}
function buildGetToken(options: AuthOptions) {
  return options.getToken ?? ((req: AxiomifyRequest) => {
    let authHeader = req.headers['authorization'];
    if (Array.isArray(authHeader)) authHeader = authHeader[0];
    return authHeader ? extractBearer(authHeader) : null;
  });
}
function validateSecret(secret: string, context: string): void {
  if (secret.length < 32) {
    const msg = `[axiomify/auth] ${context} is shorter than 32 characters. Use a cryptographically random secret of at least 256 bits.`;
    if (process.env.NODE_ENV === 'production') throw new Error(msg);
    console.warn(msg);
  }
}
function tokenOptions(options: Pick<AuthOptions, 'issuer' | 'audience'>): Pick<SignOptions & VerifyOptions, 'issuer' | 'audience'> {
  return { ...(options.issuer ? { issuer: options.issuer } : {}), ...(options.audience ? { audience: options.audience } : {}) };
}

async function verifyAsync(token: string, secret: string, options: VerifyOptions): Promise<JwtPayload> {
  const payload = await new Promise((resolve, reject) =>
    verify(token, secret, options, (err, decoded) => (err ? reject(err) : resolve(decoded))),
  );

  if (!payload || typeof payload === "string") {
    throw new Error('Invalid JWT payload type');
  }

  return payload as JwtPayload;
}

async function signAsync(payload: string | Buffer | object, secret: string, options: SignOptions): Promise<string> {
  return (await new Promise((resolve, reject) =>
    sign(payload, secret, options, (err, token) => (err || !token ? reject(err ?? new Error('Token signing failed')) : resolve(token))),
  )) as string;
}

/**
 * Creates refresh handler. Provide `store` for revocation; otherwise stolen tokens are valid until expiry.
 */
export function createRefreshHandler(options: RefreshOptions): PluginHandler {
  validateSecret(options.secret, 'JWT access secret');
  validateSecret(options.refreshSecret, 'JWT refresh secret');
  const algorithms = validateAlgorithms(options.algorithms ?? ['HS256']);
  const accessTtl = options.accessTokenTtl ?? 900;
  const refreshTtl = options.refreshTokenTtl ?? 604_800;
  const issuerAudience = tokenOptions(options);

  const handler: PluginHandler = async (req: AxiomifyRequest, res: AxiomifyResponse) => {
    const authHeader = Array.isArray(req.headers['authorization']) ? req.headers['authorization'][0] : (req.headers['authorization'] as string | undefined);
    const token = authHeader ? extractBearer(authHeader) : null;
    if (!token) return res.status(401).send(null, 'Missing refresh token');

    try {
      const decoded = await verifyAsync(token, options.refreshSecret, { algorithms, ...issuerAudience });
      const id = decoded?.id ?? decoded?.sub;
      const jti = decoded?.jti;
      if (typeof id !== 'string' || !id || typeof jti !== 'string' || !jti) return res.status(401).send(null, 'Invalid refresh token payload');

      if (options.store) {
        const exists = await options.store.exists(jti);
        if (!exists) return res.status(401).send(null, 'Refresh token has been revoked');
        await options.store.revoke(jti);
      }

      const accessToken = await signAsync({ id }, options.secret, { expiresIn: accessTtl, jwtid: randomUUID(), ...issuerAudience });
      const nextJti = randomUUID();
      const newRefreshToken = await signAsync({ id }, options.refreshSecret, { expiresIn: refreshTtl, jwtid: nextJti, ...issuerAudience });
      if (options.store) await options.store.save(nextJti, refreshTtl);

      res.status(200).send({ accessToken, refreshToken: newRefreshToken, expiresIn: accessTtl });
    } catch {
      res.status(401).send(null, 'Invalid refresh token');
    }
  };

  return handler;
}

export function createAuthPlugin(options: AuthOptions): PluginHandler {
  validateSecret(options.secret, 'JWT secret');
  const algorithms = validateAlgorithms(options.algorithms ?? ['HS256']);
  const getToken = buildGetToken(options);
  const issuerAudience = tokenOptions(options);

  return async (req: AxiomifyRequest, res: AxiomifyResponse) => {
    const token = getToken(req);
    if (!token) return res.status(401).send(null, 'Unauthorized: Missing token');
    try {
      const decoded = (await verifyAsync(token, options.secret, { algorithms, ...issuerAudience })) as AuthUser & { jti?: string };

      // Optional access token revocation — check the store if one was provided.
      // If the jti is absent from the store (was never saved or was revoked),
      // reject the request immediately without waiting for token expiry.
      if (options.store) {
        const jti = decoded.jti;
        if (!jti) return res.status(401).send(null, 'Unauthorized: Token missing jti claim');
        const active = await options.store.exists(jti);
        if (!active) return res.status(401).send(null, 'Unauthorized: Token has been revoked');
      }

      req.state.authUser = decoded;
    } catch {
      return res.status(401).send(null, 'Unauthorized: Invalid or expired token');
    }
  };
}

export const useAuth = createAuthPlugin;

export function getAuthUser(req: AxiomifyRequest): AuthUser | undefined {
  return req.state.authUser as AuthUser | undefined;
}
