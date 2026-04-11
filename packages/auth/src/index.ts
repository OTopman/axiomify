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
  getToken?: (req: AxiomifyRequest) => string | null;
}

export function useAuth(app: Axiomify, options: AuthOptions): void {
  const getToken =
    options.getToken ??
    ((req) => {
      let authHeader = req.headers['authorization'];

      // Safely unwrap it if it's an array
      if (Array.isArray(authHeader)) {
        authHeader = authHeader[0];
      }

      if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
      return null;
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
        const decoded = jwt.verify(token, options.secret) as AuthUser;
        req.user = decoded; // Type-safe assignment
      } catch (err) {
        return res
          .status(401)
          .send(null, 'Unauthorized: Invalid or expired token');
      }
    },
  );
}
