import type {
  AxiomifyRequest,
  AxiomifyResponse,
  PluginHandler,
} from '@axiomify/core';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';

declare module '@axiomify/core' {
  interface AxiomifyRequest {
    user?: AuthUser;
  }
}

export interface AuthUser {
  id: string;
  [key: string]: unknown;
}

export interface AuthOptions {
  secret: string;
  algorithms?: jwt.Algorithm[];
  getToken?: (req: AxiomifyRequest) => string | null;
  issuer?: string;
  audience?: string | string[];
}

/**
 * Implement this interface and pass it as `store` to `createRefreshHandler`
 * to enable single-use refresh token rotation (revoke on use).
 * Without a store, a stolen refresh token grants access until expiry.
 */
export interface RefreshTokenStore {
  isRevoked(tokenJti: string): Promise<boolean>;
  revoke(tokenJti: string, expiresAtUnixSeconds: number): Promise<void>;
}

export interface RefreshOptions {
  secret: string;
  refreshSecret: string;
  accessTokenTtl?: number;
  refreshTokenTtl?: number;
  algorithms?: jwt.Algorithm[];
  issuer?: string;
  audience?: string | string[];
  /**
   * Provide a store to enable refresh token rotation (strongly recommended).
   * Without this, stolen refresh tokens remain valid until expiry.
   */
  store?: RefreshTokenStore;
}

const BLOCKED_ALGORITHMS = new Set(['none', 'NONE', 'None']);

function validateAlgorithms(algorithms: string[]): jwt.Algorithm[] {
  const safe = algorithms.filter(
    (a) => !BLOCKED_ALGORITHMS.has(a),
  ) as jwt.Algorithm[];
  if (safe.length === 0) {
    throw new Error(
      '[axiomify/auth] Every provided algorithm was rejected. ' +
        'The "none" algorithm is not permitted.',
    );
  }
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
  if (secret.length < 32) {
    const msg =
      `[axiomify/auth] ${context} is shorter than 32 characters. ` +
      'Use a cryptographically random secret of at least 256 bits.';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    }
    console.warn(msg);
  }
}

function tokenOptions(
  options: Pick<AuthOptions, 'issuer' | 'audience'>,
): Pick<jwt.SignOptions & jwt.VerifyOptions, 'issuer' | 'audience'> {
  return {
    ...(options.issuer ? { issuer: options.issuer } : {}),
    ...(options.audience ? { audience: options.audience } : {}),
  };
}

export function createRefreshHandler(options: RefreshOptions) {
  validateSecret(options.secret, 'JWT access secret');
  validateSecret(options.refreshSecret, 'JWT refresh secret');

  const algorithms = validateAlgorithms(options.algorithms ?? ['HS256']);
  const accessTtl = options.accessTokenTtl ?? 900;
  const refreshTtl = options.refreshTokenTtl ?? 604_800;
  const issuerAudience = tokenOptions(options);

  if (!options.store && process.env.NODE_ENV === 'production') {
    throw new Error(
      '[axiomify/auth] Refusing to create refresh handler without a store in production. ' +
        'Refresh token rotation and revocation are required for production use.',
    );
  }

  if (!options.store) {
    console.warn(
      '[axiomify/auth] No `store` provided to createRefreshHandler. ' +
        'Refresh token rotation and revocation are DISABLED. ' +
        'A stolen refresh token will remain valid until it expires. ' +
        'Provide a store implementing RefreshTokenStore for production use.',
    );
  }

  return async (req: AxiomifyRequest, res: AxiomifyResponse) => {
    const authHeader = Array.isArray(req.headers['authorization'])
      ? req.headers['authorization'][0]
      : (req.headers['authorization'] as string | undefined);

    const token = authHeader ? extractBearer(authHeader) : null;
    if (!token) return res.status(401).send(null, 'Missing refresh token');

    try {
      // Check revocation before signature verification to fail-fast on replayed tokens.
      if (options.store) {
        // Use the raw token as the key if no jti is present (jti extraction
        // happens after verify, so we key on the token string itself here).
        if (await options.store.isRevoked(token)) {
          return res.status(401).send(null, 'Refresh token has been revoked');
        }
      }

      const decoded = jwt.verify(token, options.refreshSecret, {
        algorithms,
        ...issuerAudience,
      }) as jwt.JwtPayload;

      const id = decoded?.id ?? decoded?.sub;
      if (typeof id !== 'string' || id.length === 0) {
        return res.status(401).send(null, 'Invalid refresh token payload');
      }

      // Rotate: immediately revoke the consumed refresh token.
      if (options.store) {
        const exp = decoded.exp ?? Math.floor(Date.now() / 1000) + refreshTtl;
        await options.store.revoke(token, exp);
      }

      const accessToken = jwt.sign({ id }, options.secret, {
        expiresIn: accessTtl,
        jwtid: randomUUID(),
        ...issuerAudience,
      });

      // Issue a brand-new refresh token (rotation).
      const newRefreshToken = jwt.sign({ id }, options.refreshSecret, {
        expiresIn: refreshTtl,
        jwtid: randomUUID(),
        ...issuerAudience,
      });

      res.status(200).send({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: accessTtl,
      });
    } catch {
      res.status(401).send(null, 'Invalid refresh token');
    }
  };
}

export function createAuthPlugin(options: AuthOptions): PluginHandler {
  validateSecret(options.secret, 'JWT secret');
  const algorithms = validateAlgorithms(options.algorithms ?? ['HS256']);
  const getToken = buildGetToken(options);
  const issuerAudience = tokenOptions(options);

  return async (req: AxiomifyRequest, res: AxiomifyResponse) => {
    const token = getToken(req);

    if (!token) {
      return res.status(401).send(null, 'Unauthorized: Missing token');
    }

    try {
      const decoded = jwt.verify(token, options.secret, {
        algorithms,
        ...issuerAudience,
      }) as AuthUser;
      req.user = decoded;
    } catch {
      return res
        .status(401)
        .send(null, 'Unauthorized: Invalid or expired token');
    }
  };
}

export const useAuth = createAuthPlugin;
