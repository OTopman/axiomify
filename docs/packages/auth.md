# @axiomify/auth

JWT authentication and refresh-token rotation for Axiomify.

## Install

```bash
npm install @axiomify/auth jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

## API

| Export | Description |
|---|---|
| `createAuthPlugin(options)` | Route plugin that validates Bearer JWT tokens |
| `createRefreshHandler(options)` | Route handler that rotates refresh tokens |
| `getAuthUser(req)` | Gets the authenticated user from `req.state.authUser` |
| `MemoryTokenStore` | In-process token store — **dev/single-process only** |

## Quick start

```typescript
import { createAuthPlugin, createRefreshHandler, getAuthUser } from '@axiomify/auth';

// Protect routes
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,  // ≥ 32 characters
  algorithms: ['HS256'],
});

// Refresh endpoint
const refreshTokens = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessTokenTtl: 900,        // 15 min
  refreshTokenTtl: 2_592_000, // 30 days
  store: redisTokenStore,     // required for revocation
});

app.route({ method: 'POST', path: '/auth/refresh', handler: refreshTokens });

app.route({
  method: 'GET',
  path: '/me',
  plugins: [requireAuth],
  handler: async (req, res) => res.send(getAuthUser(req)),
});
```

## Access token revocation

Pass `store` to `createAuthPlugin` to enable immediate logout:

```typescript
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  store: redisTokenStore, // store.exists(jti) called on every authenticated request
});

// On login — save the JTI so the token is known to the store
const jti = randomUUID();
const accessToken = jwt.sign({ id: user.id, jti }, secret, { expiresIn: 900 });
await redisTokenStore.save(jti, 900);

// On logout — revoke immediately; all subsequent requests with this token → 401
await redisTokenStore.revoke(jti);
```

Tokens **must** include a `jti` claim when using `store`. Tokens without `jti` are rejected with 401.

Without `store`, access tokens are valid until they expire regardless of logout.

## Refresh token rotation

`createRefreshHandler` with `store` performs full token rotation:
1. Verifies the incoming refresh token against `refreshSecret`
2. Calls `store.exists(jti)` — rejects if missing (revoked or never saved)
3. Calls `store.revoke(jti)` — invalidates the consumed refresh token
4. Issues a new access token and a new refresh token with a new JTI
5. Calls `store.save(newJti, refreshTokenTtl)` — activates the new refresh token

## TokenStore interface

```typescript
interface TokenStore {
  save(jti: string, ttlSeconds: number): Promise<void>;
  exists(jti: string): Promise<boolean>;
  revoke(jti: string): Promise<void>;
}
```

### Redis implementation

```typescript
import { createClient } from 'redis'; // redis@4
import type { TokenStore } from '@axiomify/auth';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const redisTokenStore: TokenStore = {
  save:   (jti, ttl) => redis.set(`jwt:${jti}`, '1', { EX: ttl }).then(() => undefined),
  exists: (jti)      => redis.get(`jwt:${jti}`).then(v => v === '1'),
  revoke: (jti)      => redis.del(`jwt:${jti}`).then(() => undefined),
};
```

## `createAuthPlugin` options

| Option | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | required | JWT signing secret. Minimum 32 characters. Validated at startup. |
| `algorithms` | `Algorithm[]` | `['HS256']` | Accepted algorithms. The `'none'` algorithm is always blocked. |
| `getToken` | `(req) => string \| null` | `Authorization: Bearer` | Custom token extractor. |
| `issuer` | `string` | — | Validates the `iss` claim. |
| `audience` | `string \| string[]` | — | Validates the `aud` claim. |
| `store` | `TokenStore` | — | When set, checks `store.exists(jti)` on every request. |

## `createRefreshHandler` options

| Option | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | required | Access token secret. |
| `refreshSecret` | `string` | required | Refresh token secret. Use a different secret from `secret`. |
| `accessTokenTtl` | `number` | `900` | Access token TTL in seconds (15 min). |
| `refreshTokenTtl` | `number` | `604800` | Refresh token TTL in seconds (7 days). |
| `store` | `TokenStore` | — | **Strongly recommended.** Without it, stolen refresh tokens cannot be revoked. |
| `algorithms` | `Algorithm[]` | `['HS256']` | Accepted algorithms. |

## Rate limiting the refresh endpoint

```typescript
import { createRateLimitPlugin } from '@axiomify/rate-limit';

const refreshRateLimit = createRateLimitPlugin({
  windowMs: 15 * 60_000,
  max: 5,
  store: redisRateLimitStore,
  keyGenerator: (req) => req.body?.email ?? req.ip,
});

app.route({
  method: 'POST',
  path: '/auth/refresh',
  plugins: [refreshRateLimit],
  handler: refreshTokens,
});
```

## Production requirements

- [ ] Secrets in environment variables — never in source code or config files
- [ ] Secrets ≥ 32 characters (enforced at startup in production)
- [ ] `accessTokenTtl` ≤ 900 seconds (15 min)
- [ ] Redis-backed `TokenStore` — `MemoryTokenStore` is per-process
- [ ] `/auth/refresh` rate-limited
- [ ] `algorithms` explicitly set — never rely on defaults in production
