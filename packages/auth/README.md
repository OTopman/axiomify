# @axiomify/auth

JWT authentication and refresh-token rotation for Axiomify.

## Install

```bash
npm i @axiomify/auth
```

## Usage

```ts
import { createAuthPlugin, createRefreshHandler, MemoryTokenStore } from '@axiomify/auth';

const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  algorithms: ['HS256'],
});

const refreshStore = new MemoryTokenStore();
const refreshTokens = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  refreshTokenTtl: 60 * 60 * 24 * 30,
  store: refreshStore,
});

app.route({ method: 'POST', path: '/auth/refresh', handler: refreshTokens });
```

## Refresh token revocation

`createRefreshHandler` supports a `store` option with:

- `save(jti, ttlSeconds)`
- `exists(jti)`
- `revoke(jti)`

If `store` is not configured, refresh tokens cannot be revoked before expiry.

## Rate limiting

Use your limiter plugin on the refresh route explicitly:

```ts
app.route({
  method: 'POST',
  path: '/auth/refresh',
  plugins: [rateLimitByIP],
  handler: refreshTokens,
});
```
