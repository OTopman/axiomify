# @axiomify/auth

JWT-based authentication plugin for Axiomify with automatic `req.user` population and secure token refresh.

## Installation

```bash
npm install @axiomify/auth
```

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { createAuthPlugin, createRefreshHandler } from '@axiomify/auth';
import { z } from 'zod';

const app = new Axiomify();
const secret = 'your-secret-key-at-least-32-chars-long!';

const requireAuth = createAuthPlugin({
  secret,
  // Optional: custom header extractor (defaults to Authorization: Bearer <token>)
  getToken: (req) => (req.headers.authorization as string)?.replace('Bearer ', ''),
});

// Create a protected route
app.route({
  method: 'GET',
  path: '/profile',
  plugins: [requireAuth], // Enforces JWT validation
  schema: {
    response: z.object({ id: z.string(), email: z.string() }),
  },
  handler: async (req, res) => {
    // req.user is automatically populated with the decoded JWT payload
    return res.send({
      id: req.user.id,
      email: req.user.email,
    });
  },
});
```

## Features

- **RFC 6750 Compliant**: Extracts Bearer tokens from the `Authorization` header (case-insensitive)
- **Type-Safe**: Automatic `req.user` augmentation with TypeScript inference
- **Flexible**: Custom token extractor, custom payload transformation
- **Secure**: Enforces minimum secret entropy (32 characters recommended), warns on weak secrets
- **JWT Refresh**: Built-in `createRefreshHandler` for secure token rotation

## API Reference

### `createAuthPlugin(options)`

Creates an authentication plugin handler for `route.plugins`.

**Options:**

```typescript
interface AuthOptions {
  secret: string;                              // HS256 signing secret
  algorithm?: 'HS256' | 'HS384' | 'HS512';    // Default: HS256
  getToken?: (req: AxiomifyRequest) => string | undefined;
  onError?: (err: Error) => void;              // Custom error handler
}
```

### `createRefreshHandler(options)`

Creates a route handler for secure token refresh.

**Options:**

```typescript
interface RefreshHandlerOptions {
  secret: string;           // Access token signing secret
  refreshSecret: string;    // Refresh token signing secret (different from access secret)
  accessTokenTtl?: number;  // Access token lifetime in seconds (default: 3600)
  refreshTokenTtl?: number; // Refresh token lifetime in seconds (default: 604800)
}
```

**Usage:**

```typescript
import { createRefreshHandler } from '@axiomify/auth';

const refreshHandler = createRefreshHandler({
  secret: 'access-secret-at-least-32-chars',
  refreshSecret: 'refresh-secret-at-least-32-chars',
  accessTokenTtl: 900, // 15 minutes
});

app.route({
  method: 'POST',
  path: '/auth/refresh',
  handler: refreshHandler,
});
```

## Token Payload

The decoded JWT payload is stored in `req.user`. Standard JWT claims are supported:

```typescript
// When you create a token, include:
const token = jwt.sign({
  id: 'user-123',        // Your user ID (required for refresh)
  email: 'user@example.com',
  sub: 'alternative-id', // Subject claim (alternative to id)
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
}, secret);

// In your route handler:
app.route({
  method: 'GET',
  path: '/profile',
  plugins: [requireAuth],
  handler: async (req, res) => {
    console.log(req.user.id);    // 'user-123'
    console.log(req.user.email); // 'user@example.com'
  },
});
```

## Custom Token Extraction

```typescript
const customHeaderAuth = createAuthPlugin({
  secret: 'your-secret',
  // Extract from a custom header instead of Authorization
  getToken: (req) => req.headers['x-api-token'] as string,
});

// Or from query parameters (not recommended for production):
const queryAuth = createAuthPlugin({
  secret: 'your-secret',
  getToken: (req) => req.query.token as string,
});
```

## Security Considerations

1. **Secret Management**: Always use environment variables for secrets. Minimum 32 characters recommended.
   ```typescript
   const secret = process.env.JWT_SECRET!;
   if (secret.length < 32) {
     console.warn('JWT secret is shorter than 32 characters. Consider using a stronger secret.');
   }
   ```

2. **Token Expiry**: Always set `exp` in your token payload.
   ```typescript
   const token = jwt.sign({
     id: user.id,
     exp: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
   }, secret);
   ```

3. **Refresh Token Rotation**: Use separate signing secrets for access and refresh tokens.
   ```typescript
   const refreshHandler = createRefreshHandler({
     secret: process.env.JWT_ACCESS_SECRET!,
     refreshSecret: process.env.JWT_REFRESH_SECRET!, // Different!
   });
   ```

4. **HTTPS Only**: Always transmit tokens over HTTPS. Set secure cookies if using them:
   ```typescript
   res.header('Set-Cookie', `token=${accessToken}; Secure; HttpOnly; SameSite=Strict`);
   ```

## Errors

The auth plugin returns `401 Unauthorized` for:
- Missing Authorization header
- Malformed Bearer token
- Invalid or expired JWT signature
- Missing required `id` or `sub` claim in refresh tokens

## Testing

```typescript
import jwt from 'jsonwebtoken';

it('populates req.user with decoded JWT', async () => {
  const secret = 'test-secret-that-is-at-least-32-chars-long';
  const token = jwt.sign({ id: 'user-1' }, secret);
  
  const res = await fetch('http://localhost:3000/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  const data = await res.json();
  expect(data.id).toBe('user-1');
});
```

## License

MIT
