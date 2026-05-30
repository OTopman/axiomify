import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteMiddleware,
} from '@axiomify/core';
import { randomUUID } from 'crypto';
import type {
  Algorithm,
  JwtPayload,
  SignOptions,
  VerifyOptions,
} from 'jsonwebtoken';
import { sign, verify } from 'jsonwebtoken';
import cluster from 'cluster';

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
  private tokens = new Map<string, number>(); // jti -> expiresAt
  private pruneTimer: NodeJS.Timeout;

  constructor() {
    const isClustered =
      cluster.isWorker ||
      (cluster.workers && Object.keys(cluster.workers).length > 0);
    if (isClustered) {
      const msg =
        '[axiomify/auth] MemoryTokenStore cannot be used in clustered mode. ' +
        'Since MemoryTokenStore is per-process, token revocation will not propagate to other workers, ' +
        'creating a security vulnerability where revoked tokens remain valid on other instances. ' +
        'Please use a distributed store (e.g. Redis) instead.';
      if (process.env.NODE_ENV === 'production') {
        throw new Error(msg);
      } else {
        console.warn(msg);
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[axiomify/auth] MemoryTokenStore is per-process and not shared across ' +
          'multiple instances or workers. Revoked tokens are not propagated to other ' +
          'processes, making token revocation unreliable in multi-process deployments. ' +
          'Use a distributed store (e.g. Redis) for production.',
      );
    }
    this.pruneTimer = setInterval(() => this.prune(), 60_000);
    this.pruneTimer.unref?.();
  }

  private prune() {
    const now = Date.now();
    for (const [jti, expiresAt] of this.tokens.entries()) {
      if (expiresAt <= now) this.tokens.delete(jti);
    }
  }

  async save(jti: string, ttlSeconds: number): Promise<void> {
    this.tokens.set(jti, Date.now() + ttlSeconds * 1000);
  }

  async exists(jti: string): Promise<boolean> {
    const expiresAt = this.tokens.get(jti);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.tokens.delete(jti);
      return false;
    }
    return true;
  }

  async revoke(jti: string): Promise<void> {
    this.tokens.delete(jti);
  }

  close(): void {
    clearInterval(this.pruneTimer);
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
  rateLimitPlugin?: RouteMiddleware;
}

const BLOCKED_ALGORITHMS = new Set(['none', 'NONE', 'None']);
function validateAlgorithms(algorithms: string[]): Algorithm[] {
  const safe = algorithms.filter(
    (a) => !BLOCKED_ALGORITHMS.has(a),
  ) as Algorithm[];
  if (safe.length === 0)
    throw new Error(
      '[axiomify/auth] Every provided algorithm was rejected. The "none" algorithm is not permitted.',
    );
  return safe;
}
function extractBearer(header: string): string | null {
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}
function buildGetToken(options: AuthOptions) {
  return (
    options.getToken ??
    ((req: AxiomifyRequest) => {
      let authHeader = req.headers['authorization'];
      if (Array.isArray(authHeader)) authHeader = authHeader[0];
      return authHeader ? extractBearer(authHeader) : null;
    })
  );
}
function validateSecret(secret: string, context: string): void {
  // RFC 7518 §3.2 requires HS256 keys to be at least 256 bits (32 bytes).
  // We measure UTF-8 byte length, not character count: a 32-character base64
  // string is only 24 bytes (192 bits), well below spec. Counting characters
  // would silently accept under-strength keys.
  const byteLength = Buffer.byteLength(secret, 'utf8');
  if (byteLength < 32) {
    const msg =
      `[axiomify/auth] ${context} is ${byteLength} bytes; ` +
      `the JWA spec (RFC 7518 §3.2) requires at least 32 bytes (256 bits) for HS256. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`;
    if (process.env.NODE_ENV === 'production') throw new Error(msg);
    console.warn(msg);
  }
}
function tokenOptions(
  options: Pick<AuthOptions, 'issuer' | 'audience'>,
): Pick<SignOptions & VerifyOptions, 'issuer' | 'audience'> {
  return {
    ...(options.issuer ? { issuer: options.issuer } : {}),
    ...(options.audience ? { audience: options.audience } : {}),
  } as Pick<SignOptions & VerifyOptions, 'issuer' | 'audience'>;
}

async function verifyAsync(
  token: string,
  secret: string,
  options: VerifyOptions,
): Promise<JwtPayload> {
  const payload = await new Promise((resolve, reject) =>
    verify(token, secret, options, (err, decoded) =>
      err ? reject(err) : resolve(decoded),
    ),
  );

  if (!payload || typeof payload === 'string') {
    const err = new Error('Invalid JWT payload type');
    err.name = 'JsonWebTokenError';
    throw err;
  }

  return payload as JwtPayload;
}

async function signAsync(
  payload: string | Buffer | object,
  secret: string,
  options: SignOptions,
): Promise<string> {
  return (await new Promise((resolve, reject) =>
    sign(payload, secret, options, (err, token) =>
      err || !token
        ? reject(err ?? new Error('Token signing failed'))
        : resolve(token),
    ),
  )) as string;
}

/**
 * Creates refresh handler. Provide `store` for revocation; otherwise stolen tokens are valid until expiry.
 */
export function createRefreshHandler(options: RefreshOptions): RouteMiddleware {
  validateSecret(options.secret, 'JWT access secret');
  validateSecret(options.refreshSecret, 'JWT refresh secret');
  const algorithms = validateAlgorithms(options.algorithms ?? ['HS256']);
  const accessTtl = options.accessTokenTtl ?? 900;
  const refreshTtl = options.refreshTokenTtl ?? 604_800;
  const issuerAudience = tokenOptions(options);

  const handler: RouteMiddleware = async (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) => {
    const authHeader = Array.isArray(req.headers['authorization'])
      ? req.headers['authorization'][0]
      : (req.headers['authorization'] as string | undefined);
    const token = authHeader ? extractBearer(authHeader) : null;
    if (!token) return res.status(401).send(null, 'Missing refresh token');

    // Split JWT validation from infrastructure errors so the outer catch can
    // surface 503s for store/sign failures instead of masking them as 401s.
    let decoded: JwtPayload;
    try {
      decoded = await verifyAsync(token, options.refreshSecret, {
        algorithms,
        ...issuerAudience,
      });
    } catch {
      return res.status(401).send(null, 'Invalid refresh token');
    }

    const id = decoded?.id ?? decoded?.sub;
    const jti = decoded?.jti;
    if (typeof id !== 'string' || !id || typeof jti !== 'string' || !jti) {
      return res.status(401).send(null, 'Invalid refresh token payload');
    }

    // Check token existence in the revocation store. A store error here is
    // infrastructure failure (not a client problem) → 503.
    if (options.store) {
      let exists: boolean;
      try {
        exists = await options.store.exists(jti);
      } catch {
        return res.status(503).send(null, 'Token store unavailable');
      }
      if (!exists)
        return res.status(401).send(null, 'Refresh token has been revoked');
    }

    // Order is critical: save the NEW jti BEFORE revoking the OLD one. If
    // signAsync() or store.save() fails, the user can retry the same refresh
    // request — the old refresh token is still valid. The previous order
    // (revoke → sign → save) silently logged users out on transient store
    // failures by destroying the old token before its replacement existed.
    let accessToken: string;
    let newRefreshToken: string;
    const nextJti = randomUUID();
    try {
      accessToken = await signAsync({ id }, options.secret, {
        expiresIn: accessTtl,
        jwtid: randomUUID(),
        ...issuerAudience,
      });
      newRefreshToken = await signAsync({ id }, options.refreshSecret, {
        expiresIn: refreshTtl,
        jwtid: nextJti,
        ...issuerAudience,
      });
    } catch {
      return res.status(500).send(null, 'Failed to issue tokens');
    }

    if (options.store) {
      try {
        await options.store.save(nextJti, refreshTtl);
      } catch {
        // New jti could not be persisted → do NOT revoke the old one.
        // Client can safely retry the refresh.
        return res.status(503).send(null, 'Token store unavailable');
      }
      // New token now exists in the store. Safe to revoke the old one.
      // A failure here is a soft inconsistency — caller still has a valid new
      // pair; the old jti will expire naturally. Log but do not fail the call.
      try {
        await options.store.revoke(jti);
      } catch {
        // Intentionally swallowed: client already has new credentials.
      }
    }

    res.status(200).send({
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtl,
    });
  };

  return handler;
}

export function createAuthPlugin(options: AuthOptions): RouteMiddleware {
  validateSecret(options.secret, 'JWT secret');
  const algorithms = validateAlgorithms(options.algorithms ?? ['HS256']);
  const getToken = buildGetToken(options);
  const issuerAudience = tokenOptions(options);

  return async (req: AxiomifyRequest, res: AxiomifyResponse) => {
    const token = getToken(req);
    if (!token)
      return res.status(401).send(null, 'Unauthorized: Missing token');
    try {
      const decoded = await verifyAsync(token, options.secret, {
        algorithms,
        ...issuerAudience,
      });
      if (options.store) {
        const jti = (decoded as any).jti as string | undefined;
        if (!jti)
          return res
            .status(401)
            .send(null, 'Unauthorized: Token missing jti claim');
        let active: boolean;
        try {
          active = await options.store.exists(jti);
        } catch (storeErr) {
          // Store is unavailable — fail closed with 500, not 401
          throw Object.assign(new Error('Token store unavailable'), {
            statusCode: 503,
          });
        }
        if (!active)
          return res
            .status(401)
            .send(null, 'Unauthorized: Token has been revoked');
      }
      req.state.user = decoded;
    } catch (err) {
      // Only treat JWT errors as 401; re-throw infra errors
      const name = (err as Error)?.name ?? '';
      if (
        name === 'JsonWebTokenError' ||
        name === 'TokenExpiredError' ||
        name === 'NotBeforeError'
      ) {
        return res
          .status(401)
          .send(null, 'Unauthorized: Invalid or expired token');
      }
      throw err; // 503 or other — dispatcher sends correct status
    }
  };
}

export const useAuth = createAuthPlugin;

export function getAuthUser(req: AxiomifyRequest): AuthUser | undefined {
  return req.state.user as AuthUser | undefined;
}
