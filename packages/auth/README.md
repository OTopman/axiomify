# @axiomify/auth

[![npm version](https://img.shields.io/npm/v/@axiomify/auth.svg)](https://npmjs.com/package/@axiomify/auth)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

JWT authentication (HS256 and RS256/RS384/RS512/ES256/ES384 with JWKS), refresh-token rotation, API keys and OAuth 2.0 / OIDC (Authorization Code + PKCE) for Axiomify.

## Install

```bash
npm install @axiomify/auth jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

## Quick start

```typescript
import {
  createAuthPlugin,
  createRefreshHandler,
  getAuthUser,
  MemoryTokenStore,
} from '@axiomify/auth';

// Use Redis in production — MemoryTokenStore is per-process and breaks across workers.
const tokenStore = new MemoryTokenStore();

// Auth plugin — attach to any route that requires a valid JWT
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!, // ≥ 32 bytes (256 bits, RFC 7518 §3.2)
  algorithms: ['HS256'],
  store: tokenStore, // optional: enables access token revocation
});

// Refresh handler — issues a new access token from a valid refresh token
const refreshTokens = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessTokenTtl: 900, // 15 minutes
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

Exactly **one** of `secret`, `publicKey` or `jwks` must be provided.

| Option           | Type                              | Description                                                                                                                            |
| ---------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `secret`         | `string`                          | HS* shared secret. Minimum **32 bytes** (256 bits) per RFC 7518 §3.2. **Throws** for shorter values (in all environments).             |
| `publicKey`      | `string \| KeyObject`             | RS256/RS384/RS512/ES256/ES384 verification key (PEM or `node:crypto` KeyObject). Default allowlist: `['RS256']`.                       |
| `jwks`           | `JwksClient \| JwksClientOptions` | JWKS-backed verification (e.g. an OIDC provider): `{ url: 'https://issuer/.well-known/jwks.json' }`.                                   |
| `algorithms`     | `Algorithm[]`                     | Accepted algorithms. Default: `['HS256']` with `secret`, `['RS256']` with `publicKey`/`jwks`. Never include `'none'`.                  |
| `getToken`       | `(req) => string \| null`         | Custom token extractor. Default: `Authorization: Bearer <token>`.                                                                      |
| `issuer`         | `string`                          | Validates the `iss` claim.                                                                                                             |
| `audience`       | `string \| string[]`              | Validates the `aud` claim.                                                                                                             |
| `clockTolerance` | `number`                          | Seconds of leeway for `exp`/`nbf` comparisons. Default `0`.                                                                            |
| `store`          | `TokenStore`                      | **Access token revocation store.** When set, every request checks `store.exists(jti)`. Rejected if false.                              |

HS* algorithms can never be combined with `publicKey`/`jwks`, and RS*/ES* can never be verified with `secret` — both directions of the classic JWT algorithm-confusion attack are rejected at plugin creation or verification time.

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

| Option            | Type          | Description                                                                                                |
| ----------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `secret`          | `string`             | Access token secret. Minimum **32 bytes** (256 bits) per RFC 7518 §3.2.                                    |
| `refreshSecret`   | `string`             | Separate secret for refresh tokens. Minimum **32 bytes** (256 bits).                                       |
| `accessTokenTtl`  | `number`             | Access token TTL in seconds. Default: `900` (15 min).                                                      |
| `refreshTokenTtl` | `number`             | Refresh token TTL in seconds. Default: `604800` (7 days).                                                  |
| `store`           | `TokenStore`         | Refresh token revocation store. Strongly recommended. Without it, stolen refresh tokens cannot be revoked. |
| `algorithms`      | `Algorithm[]`        | Algorithms. Default: `['HS256']`.                                                                          |
| `issuer`          | `string`             | Validates the `iss` claim on refresh tokens and sets it on issued tokens.                                  |
| `audience`        | `string \| string[]` | Validates the `aud` claim on refresh tokens and sets it on issued tokens.                                  |
| `rateLimitPlugin` | `RouteMiddleware`    | Optional rate-limit plugin reference for route wiring. Apply it on `/auth/refresh` via `plugins: [rateLimitPlugin]`. |

## TokenStore interface

```typescript
interface TokenStore {
  save(jti: string, ttlSeconds: number): Promise<void>;
  exists(jti: string): Promise<boolean>;
  revoke(jti: string): Promise<void>;
}
```

**`MemoryTokenStore`** — in-process store. Only suitable for single-process development. It **throws** if constructed in clustered mode under `NODE_ENV=production` (revocation cannot propagate across workers) and warns otherwise. Call `store.close()` to clear its internal prune timer.

**Production:** Implement `TokenStore` against Redis:

```typescript
import { createClient } from 'redis';
import type { TokenStore } from '@axiomify/auth';

const redis = createClient();
await redis.connect();

const redisStore: TokenStore = {
  save: (jti, ttl) =>
    redis.set(`jwt:${jti}`, '1', { EX: ttl }).then(() => undefined),
  exists: (jti) => redis.get(`jwt:${jti}`).then((v) => v === '1'),
  revoke: (jti) => redis.del(`jwt:${jti}`).then(() => undefined),
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

## RS256 / ES256 and JWKS

Asymmetric verification runs on a built-in `node:crypto` engine (no extra
dependencies). `signJwt`/`verifyJwt` support `HS256/HS384/HS512`,
`RS256/RS384/RS512` and `ES256/ES384` (ES* signatures use the JOSE raw
`r||s` format, never DER).

```typescript
import { createAuthPlugin, signJwt, verifyJwt, JwksClient } from '@axiomify/auth';

// Verify with a local public key (PEM string or KeyObject)
const requireAuth = createAuthPlugin({
  publicKey: process.env.JWT_PUBLIC_KEY!,
  algorithms: ['RS256'],
  issuer: 'https://issuer.example.com',
  audience: 'my-api',
});

// Or verify against a remote JWKS (OIDC providers, key rotation)
const requireOidcAuth = createAuthPlugin({
  jwks: { url: 'https://issuer.example.com/.well-known/jwks.json' },
  algorithms: ['RS256', 'ES256'],
  issuer: 'https://issuer.example.com',
});

// Issue tokens yourself
const token = signJwt(
  { sub: user.id },
  { algorithm: 'RS256', privateKey: process.env.JWT_PRIVATE_KEY!, expiresIn: 900, keyid: 'key-1' },
);
```

`JwksClient` caches keys by `kid` (default TTL 10 minutes), refetches on
unknown `kid` for key rotation — but never more often than every 30 seconds
(forged-`kid` DoS protection) — and retains at most 32 keys. Symmetric
(`oct`) JWKs are discarded so a hostile JWKS can never enable HS*.

Security guarantees (both engines):

- `alg: none` is rejected unconditionally and can never be allowlisted.
- The token header's `alg` must be in the caller's explicit allowlist.
- Key material type is bound to the algorithm family: a public/JWKS key can
  never verify an HS* token and a symmetric secret can never verify RS*/ES*
  (algorithm-confusion defence in both directions).
- JWKS outages surface as **503**, never 401.

## API keys

Key format: `ax_<id>_<secret>`. Only the SHA-256 hash of the secret is
stored; comparison is constant-time (`crypto.timingSafeEqual`), and unknown
ids cost the same as wrong secrets (no enumeration timing oracle).

```typescript
import { createApiKeyPlugin, generateApiKey, hashApiKeySecret, getApiKey } from '@axiomify/auth';

// Generate a key: give `apiKey` to the caller ONCE, persist { id, hashedKey }
const { apiKey, id, hashedKey } = generateApiKey();

// Static keys (hashed)…
const apiKeys = createApiKeyPlugin({
  keys: { [id]: { hashedKey, scopes: ['read', 'write'], meta: { plan: 'pro' } } },
});

// …or a dynamic lookup (database) — errors here → 503, never 401
const apiKeysDb = createApiKeyPlugin({
  lookup: async (id) => db.apiKeys.findById(id), // { hashedKey, scopes?, meta? } | null
  header: 'x-api-key', // default
});

app.route({
  method: 'GET',
  path: '/admin',
  plugins: [apiKeys.requireApiKey(['admin'])], // 401 invalid key, 403 missing scope
  handler: async (req, res) => res.send(getApiKey(req)),
});
```

Plaintext values in `keys` are hashed at startup but log a warning — store
`hashApiKeySecret(secret)` output instead. On success `req.state.user`
(`{ id, scopes, authType: 'api-key' }`, frozen) and `req.state.apiKey` are
populated.

## OAuth 2.0 / OIDC (Authorization Code + PKCE)

```typescript
import { createOAuthPlugin } from '@axiomify/auth';

const google = createOAuthPlugin({
  provider: 'google', // 'google' | 'github' | 'auth0' | 'oidc'
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://app.example.com/auth/google/callback',
  cookieSecret: process.env.COOKIE_SECRET!, // ≥ 32 bytes, signs the state cookie
});

app.route({ method: 'GET', path: '/auth/google', handler: google.authorizeHandler });
app.route({
  method: 'GET',
  path: '/auth/google/callback',
  handler: google.callbackHandler(async (req, res, { tokens, profile }) => {
    // tokens.accessToken, tokens.idTokenClaims (verified), profile (userinfo)
    const session = await createSession(profile);
    res.status(302).header('Location', '/dashboard').send(null);
  }),
});
```

- **PKCE is always on** with the `S256` method — never `plain`.
- `state`, the PKCE `code_verifier` and the OIDC `nonce` travel in a signed,
  HttpOnly, `SameSite=Lax` cookie with a 10-minute lifetime; the state
  comparison is constant-time and the cookie is one-shot.
- For `auth0`/`oidc`, pass `issuer` — endpoints are discovered from
  `<issuer>/.well-known/openid-configuration` and cached for an hour.
  Manual `endpoints` overrides always win.
- ID tokens are verified via JWKS (`iss`, `aud = clientId`, `exp`, `nonce`)
  before they are trusted; set `verifyIdToken: false` only if your provider
  has no published JWKS.
- Error handling: pass an optional `onError(req, res, error)` as the second
  argument of `callbackHandler`; otherwise failures respond with the
  `OAuthError`'s status (400 for state/CSRF issues, 401 for ID-token
  failures, 502/503 for provider outages).

## Helper

```typescript
import { getAuthUser } from '@axiomify/auth';

const user = getAuthUser(req); // AuthUser | undefined
```

> `useAuth` is exported as an alias of `createAuthPlugin`.
