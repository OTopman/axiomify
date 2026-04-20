import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import * as jwt from 'jsonwebtoken';

// Type-Safe Module Augmentation for req.user
declare module '@axiomify/core' {
  interface AxiomifyRequest {
    user?: AuthUser;
  }
}

export interface AuthUser {
  id: string;
  [key: string]: any;
}

export interface AuthOptions {
  secret: string;
  algorithms?: jwt.Algorithm[];
  getToken?: (req: AxiomifyRequest) => string | null;
}

export interface RefreshOptions {
  secret: string;
  refreshSecret: string;
  accessTokenTtl?: number;
  refreshTokenTtl?: number;
  algorithms?: jwt.Algorithm[];
}

/**
 * Extracts a bearer token from an Authorization header. Per RFC 6750 §2.1 the
 * scheme name is case-insensitive, so "bearer xyz" and "BEARER xyz" must work
 * the same as "Bearer xyz". Also tolerates extra whitespace between scheme
 * and credential.
 */
function extractBearer(header: string): string | null {
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export function createRefreshHandler(options: RefreshOptions) {
  return async (req: any, res: any) => {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;

    const token = authHeader ? extractBearer(authHeader) : null;
    if (!token) return res.status(401).send(null, 'Missing refresh token');

    try {
      const decoded = jwt.verify(token, options.refreshSecret, {
        algorithms: options.algorithms ?? ['HS256'],
      }) as any;

      // A valid signature over an empty / malformed payload shouldn't mint an
      // access token with `id: undefined`. Require an explicit subject id.
      const id = decoded?.id ?? decoded?.sub;
      if (typeof id !== 'string' || id.length === 0) {
        return res.status(401).send(null, 'Invalid refresh token payload');
      }

      const accessToken = jwt.sign({ id }, options.secret, {
        expiresIn: options.accessTokenTtl ?? 900,
      });
      res
        .status(200)
        .send({ accessToken, expiresIn: options.accessTokenTtl ?? 900 });
    } catch {
      res.status(401).send(null, 'Invalid refresh token');
    }
  };
}

export function useAuth(app: Axiomify, options: AuthOptions): void {
  if (options.secret.length < 32) {
    console.warn(
      '[axiomify/auth] JWT secret is shorter than 32 characters. ' +
        'Use a cryptographically random secret of at least 256 bits in production.',
    );
  }

  const getToken =
    options.getToken ??
    ((req) => {
      let authHeader = req.headers['authorization'];

      // Safely unwrap it if it's an array
      if (Array.isArray(authHeader)) {
        authHeader = authHeader[0];
      }

      return authHeader ? extractBearer(authHeader) : null;
    });

  // The core authentication plugin
  app.registerPlugin(
    'requireAuth',
    async (req: AxiomifyRequest, res: AxiomifyResponse) => {
      const token = getToken(req);

      if (!token) {
        return res.status(401).send(null, 'Unauthorized: Missing token');
      }

      try {
        const decoded = jwt.verify(token, options.secret, {
          algorithms: options.algorithms ?? ['HS256'],
        }) as AuthUser;
        req.user = decoded; // Type-safe assignment
      } catch (err) {
        return res
          .status(401)
          .send(null, 'Unauthorized: Invalid or expired token');
      }
    },
  );
}
