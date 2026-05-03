# @axiomify/auth

JWT authentication and refresh-token rotation for Axiomify.

## Install

```bash
npm install @axiomify/auth jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

## Quick start

```typescript
import { createAuthPlugin, createRefreshHandler, MemoryTokenStore } from '@axiomify/auth';

// Use Redis in production — MemoryTokenStore is per-process and breaks across workers.
const tokenStore = new MemoryTokenStore();

// Auth plugin — attach to any route that requires a valid JWT
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,   // minimum 32 characters
  algorithms: ['HS256'],
  store: tokenStore,  // optional: enables access token revocation
});

// Refresh handler — issues a new access token from a valid refresh token
const refreshTokens = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessTokenTtl: 900,        // 15 minutes
  refreshTokenTtl: 2_592_000, // 30 days
  store: tokenStore,
});

// Routes
app.route({ method: 'POST', path: '/auth/refresh', handler: refreshTokens });

app.route({
  method: 'GET',
  path: '/me',
  plugins: [requireAuth],
  handler: async (req, res) => {
    const user = getAuthUser(req); // typed: AuthUser | undefined
    res.send(user);
  },
});
```

## Options

### `createAuthPlugin(options)`

| Option | Type | Description |
|---|---|---|
| `secret` | `string` | JWT signing secret. Minimum 32 characters. |
| `algorithms` | `Algorithm[]` | Accepted algorithms. Default: `['HS256']`. Never include `'none'`. |
| `getToken` | `(req) => string \| null` | Custom token extractor. Default: `Authorization: Bearer <token>`. |
| `issuer` | `string` | Validates the `iss` claim. |
| `audience` | `string \| string[]` | Validates the `aud` claim. |
| `store` | `TokenStore` | **Access token revocation store.** When set, every request checks `store.exists(jti)`. Rejected if false. |

### Access token revocation with `store`

When you provide a `store`, the plugin checks `store.exists(jti)` on every authenticated
request. To revoke a token (e.g., on logout):

```typescript
// On login — save the token's jti so exists() returns true
const jti = randomUUID();
const accessToken = jwt.sign({ id: user.id, jti }, secret, { expiresIn: 900 });
await tokenStore.save(jti, 900);

// On logout — revoke immediately, before the token expires
await tokenStore.revoke(jti);
// All subsequent requests with that token return 401
```

**Without a store**, access tokens are valid until they expire regardless of logout.

### `createRefreshHandler(options)`

| Option | Type | Description |
|---|---|---|
| `secret` | `string` | Access token secret. |
| `refreshSecret` | `string` | Separate secret for refresh tokens. |
| `accessTokenTtl` | `number` | Access token TTL in seconds. Default: `900` (15 min). |
| `refreshTokenTtl` | `number` | Refresh token TTL in seconds. Default: `604800` (7 days). |
| `store` | `TokenStore` | Refresh token revocation store. Strongly recommended. Without it, stolen refresh tokens cannot be revoked. |
| `algorithms` | `Algorithm[]` | Algorithms. Default: `['HS256']`. |

## TokenStore interface

```typescript
interface TokenStore {
  save(jti: string, ttlSeconds: number): Promise<void>;
  exists(jti: string): Promise<boolean>;
  revoke(jti: string): Promise<void>;
}
```

**`MemoryTokenStore`** — in-process store. Only suitable for single-process development.

**Production:** Implement `TokenStore` against Redis:

```typescript
import { createClient } from 'redis';
import type { TokenStore } from '@axiomify/auth';

const redis = createClient();
await redis.connect();

const redisStore: TokenStore = {
  save:   (jti, ttl) => redis.set(`jwt:${jti}`, '1', { EX: ttl }).then(() => undefined),
  exists: (jti)      => redis.get(`jwt:${jti}`).then(v => v === '1'),
  revoke: (jti)      => redis.del(`jwt:${jti}`).then(() => undefined),
};
```

## Rate limiting refresh endpoints

Always rate-limit `/auth/refresh` — brute-forcing refresh tokens is a common attack:

```typescript
import { createRateLimitPlugin } from '@axiomify/rate-limit';

const refreshRateLimit = createRateLimitPlugin({
  windowMs: 60_000,
  max: 10,
  store: redisRateLimitStore,
});

app.route({
  method: 'POST',
  path: '/auth/refresh',
  plugins: [refreshRateLimit],
  handler: refreshTokens,
});
```

## Helper

```typescript
import { getAuthUser } from '@axiomify/auth';

const user = getAuthUser(req); // AuthUser | undefined
```
