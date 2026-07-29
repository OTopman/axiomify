# @axiomify/auth

JWT authentication (HS256 and RS256/RS384/RS512/ES256/ES384 with JWKS), refresh-token rotation, API keys and OAuth 2.0 / OIDC (Authorization Code + PKCE) for Axiomify.

## Install

```bash
npm install @axiomify/auth jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

## API

| Export                          | Description                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `createAuthPlugin(options)`     | Route plugin that validates Bearer JWT tokens                                                                 |
| `createRefreshHandler(options)` | Route handler that rotates refresh tokens                                                                     |
| `getAuthUser(req)`              | Returns the authenticated payload from `req.state.user` (set by `createAuthPlugin` after token verification). |
| `MemoryTokenStore`              | In-process token store — **dev/single-process only**                                                          |
| `signJwt(payload, options)`     | Sign a JWT with HS*/RS*/ES* via `node:crypto` (no jsonwebtoken dependency)                                     |
| `verifyJwt(token, options)`     | Verify a JWT with a strict per-call algorithm allowlist and confusion defences                                 |
| `JwksClient`                    | JWKS (RFC 7517) key resolver with kid-cache, rotation refetch and cooldown                                     |
| `createApiKeyPlugin(options)`   | API-key authentication (`ax_<id>_<secret>`, sha256-hashed, constant-time)                                      |
| `generateApiKey(id?)` / `hashApiKeySecret(secret)` / `getApiKey(req)` | API-key helpers                                                          |
| `createOAuthPlugin(options)`    | OAuth 2.0 / OIDC Authorization Code flow with PKCE (S256)                                                      |

## Quick start

```typescript
import {
  createAuthPlugin,
  createRefreshHandler,
  getAuthUser,
} from '@axiomify/auth';

// Protect routes
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!, // ≥ 32 bytes (256 bits, RFC 7518 §3.2)
  algorithms: ['HS256'],
});

// Refresh endpoint
const refreshTokens = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessTokenTtl: 900, // 15 min
  refreshTokenTtl: 2_592_000, // 30 days
  store: redisTokenStore, // required for revocation
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

1. Verifies the incoming refresh token against `refreshSecret`. JWT verification failures → **401**.
2. Calls `store.exists(jti)` — rejects with **401** if missing (revoked or never saved). Infrastructure errors here → **503** (was silently coerced to 401 in 4.x).
3. Signs the new access token and the new refresh token with a fresh `jti`.
4. Calls `store.save(newJti, refreshTokenTtl)` — activates the new refresh token. Store failure → **503** and the old `jti` is **NOT** revoked, so the client can safely retry.
5. Returns the new token pair to the client.
6. Calls `store.revoke(oldJti)` — invalidates the consumed refresh token. Failures here are soft-swallowed; the client already has new credentials and the old `jti` will expire naturally.

> **Why save-then-revoke and not revoke-then-save?** A transient Redis blip between revoke and save in the old order hard-logged-out users — the previous refresh token was destroyed but the replacement was never persisted. Save-then-revoke makes the worst case a recoverable retry instead of a permanent logout.

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
  save: (jti, ttl) =>
    redis.set(`jwt:${jti}`, '1', { EX: ttl }).then(() => undefined),
  exists: (jti) => redis.get(`jwt:${jti}`).then((v) => v === '1'),
  revoke: (jti) => redis.del(`jwt:${jti}`).then(() => undefined),
};
```

## `createAuthPlugin` options

Exactly **one** of `secret`, `publicKey` or `jwks` must be provided.

| Option           | Type                              | Default                 | Description                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `secret`         | `string`                          | one-of                  | HS* shared secret. Minimum **32 bytes** (256 bits, per RFC 7518 §3.2 for HS256). Validated at startup. Generate via `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.                                               |
| `publicKey`      | `string \| KeyObject`             | one-of                  | RS256/RS384/RS512/ES256/ES384 verification key — PEM string or `node:crypto` KeyObject.                                                                                                                                                          |
| `jwks`           | `JwksClient \| JwksClientOptions` | one-of                  | JWKS-backed verification, e.g. `{ url: 'https://issuer/.well-known/jwks.json' }`.                                                                                                                                                                |
| `algorithms`     | `Algorithm[]`                     | `['HS256']` / `['RS256']` | Accepted algorithms (`['HS256']` with `secret`, `['RS256']` with `publicKey`/`jwks`). The `'none'` algorithm is always blocked; HS* cannot be allowlisted alongside `publicKey`/`jwks`.                                                        |
| `getToken`       | `(req) => string \| null`         | `Authorization: Bearer` | Custom token extractor.                                                                                                                                                                                                                          |
| `issuer`         | `string`                          | —                       | Validates the `iss` claim.                                                                                                                                                                                                                       |
| `audience`       | `string \| string[]`              | —                       | Validates the `aud` claim.                                                                                                                                                                                                                       |
| `clockTolerance` | `number`                          | `0`                     | Seconds of leeway for `exp`/`nbf` comparisons.                                                                                                                                                                                                   |
| `store`          | `TokenStore`                      | —                       | When set, checks `store.exists(jti)` on every request.                                                                                                                                                                                           |

## `createRefreshHandler` options

| Option            | Type          | Default     | Description                                                                    |
| ----------------- | ------------- | ----------- | ------------------------------------------------------------------------------ |
| `secret`          | `string`      | required    | Access token secret.                                                           |
| `refreshSecret`   | `string`      | required    | Refresh token secret. Use a different secret from `secret`.                    |
| `accessTokenTtl`  | `number`      | `900`       | Access token TTL in seconds (15 min).                                          |
| `refreshTokenTtl` | `number`      | `604800`    | Refresh token TTL in seconds (7 days).                                         |
| `store`           | `TokenStore`  | —           | **Strongly recommended.** Without it, stolen refresh tokens cannot be revoked. |
| `algorithms`      | `Algorithm[]` | `['HS256']` | Accepted algorithms.                                                           |

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

## Asymmetric JWTs (RS256/RS384/RS512/ES256/ES384) and JWKS

Asymmetric signing and verification run on a built-in `node:crypto` engine —
no new dependencies. ES* signatures use the JOSE raw `r||s` encoding
(`dsaEncoding: 'ieee-p1363'`), never ASN.1/DER.

```typescript
import { createAuthPlugin, signJwt, verifyJwt, JwksClient } from '@axiomify/auth';

// Local public key (PEM string or KeyObject)
const requireAuth = createAuthPlugin({
  publicKey: process.env.JWT_PUBLIC_KEY!,
  algorithms: ['RS256'],
  issuer: 'https://issuer.example.com',
  audience: 'my-api',
});

// Remote JWKS — OIDC providers, automatic key rotation
const requireOidcAuth = createAuthPlugin({
  jwks: { url: 'https://issuer.example.com/.well-known/jwks.json' },
  algorithms: ['RS256', 'ES256'],
  issuer: 'https://issuer.example.com',
});

// Issue tokens
const token = signJwt(
  { sub: user.id },
  {
    algorithm: 'ES256',
    privateKey: process.env.JWT_PRIVATE_KEY!, // PEM or KeyObject
    expiresIn: 900,
    keyid: 'key-2026-01',
  },
);

// Standalone verification (e.g. outside a route)
const claims = await verifyJwt(token, {
  algorithms: ['ES256'],
  publicKey: process.env.JWT_PUBLIC_KEY!,
  issuer: 'https://issuer.example.com',
  clockTolerance: 5,
});
```

### `JwksClient` options

| Option             | Type     | Default   | Description                                                                        |
| ------------------ | -------- | --------- | ---------------------------------------------------------------------------------- |
| `url`              | `string` | required  | JWKS document URL.                                                                 |
| `cacheTtlMs`       | `number` | `600000`  | Key-set cache lifetime (10 min).                                                   |
| `cooldownMs`       | `number` | `30000`   | Minimum interval between unknown-`kid` refetches. **Hard floor: 30 s** (DoS guard). |
| `maxKeys`          | `number` | `32`      | Maximum keys retained from the document (memory bound).                            |
| `requestTimeoutMs` | `number` | `10000`   | Fetch timeout.                                                                     |

### Security model

- `alg: none` (any casing) is rejected unconditionally and can never be allowlisted.
- The token header's `alg` must be an exact member of the caller's explicit allowlist.
- **Algorithm-confusion defence, both directions:** a public key or JWKS can never
  verify an HS* token (the classic public-PEM-as-HMAC-secret attack), and a
  symmetric secret can never verify an RS*/ES* token. Enforced at the allowlist
  level *and* at the key-material level.
- Symmetric (`oct`) JWKs in a JWKS document are discarded; only RSA/EC `sig` keys
  with a `kid` are retained. A token without `kid` resolves only when exactly one
  compatible key exists.
- JWKS transport failures raise `JwksFetchError` → **503**, never 401.

## API keys

Key format: `ax_<id>_<secret>`. The `id` locates the record; only
`sha256(secret)` is stored or compared (`crypto.timingSafeEqual` on
fixed-length digests). Unknown ids run a dummy compare so key discovery
cannot be timed.

```typescript
import { createApiKeyPlugin, generateApiKey, hashApiKeySecret, getApiKey } from '@axiomify/auth';

// Provisioning: give `apiKey` to the caller ONCE, persist { id, hashedKey }
const { apiKey, id, hashedKey } = generateApiKey();

const apiKeys = createApiKeyPlugin({
  // Static map (dev/small deployments)…
  keys: { [id]: { hashedKey, scopes: ['read', 'write'], meta: { plan: 'pro' } } },
  // …OR a dynamic lookup — lookup errors → 503, never 401
  // lookup: async (id) => db.apiKeys.findById(id), // { hashedKey, scopes?, meta? } | null
});

app.route({
  method: 'DELETE',
  path: '/records/:id',
  plugins: [apiKeys.requireApiKey(['write'])], // 401 invalid, 403 missing scope
  handler: async (req, res) => {
    const key = getApiKey(req); // { id, scopes, meta? }
    // req.state.user = { id, scopes, authType: 'api-key' } (frozen)
  },
});
```

| Option   | Type                                  | Default     | Description                                                                                    |
| -------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `keys`   | `Record<string, ApiKeyRecord\|string>` | one-of      | Static id → `{ hashedKey, scopes?, meta? }` map. Plaintext strings are hashed but log a warning. |
| `lookup` | `(id) => Promise<ApiKeyRecord\|null>`  | one-of      | Dynamic resolver (database). Thrown errors surface as **503**.                                  |
| `header` | `string`                              | `x-api-key` | Request header carrying the key.                                                                |
| `scopes` | `string[]`                            | `[]`        | Default scopes required by `requireApiKey()` without arguments.                                 |

## OAuth 2.0 / OIDC — Authorization Code + PKCE

```typescript
import { createOAuthPlugin } from '@axiomify/auth';

const google = createOAuthPlugin({
  provider: 'google', // 'google' | 'github' | 'auth0' | 'oidc'
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://app.example.com/auth/google/callback',
  cookieSecret: process.env.COOKIE_SECRET!, // ≥ 32 bytes
});

app.route({ method: 'GET', path: '/auth/google', handler: google.authorizeHandler });
app.route({
  method: 'GET',
  path: '/auth/google/callback',
  handler: google.callbackHandler(
    async (req, res, { tokens, profile }) => {
      // tokens: { accessToken, refreshToken?, idToken?, idTokenClaims?, expiresIn?, raw }
      // profile: userinfo document (or verified ID-token claims as fallback)
      res.status(302).header('Location', '/dashboard').send(null);
    },
    async (req, res, error) => {
      // optional: error.code ∈ state_mismatch | invalid_state_cookie | token_exchange_failed | …
      res.status(error.statusCode).send(null, error.message);
    },
  ),
});
```

| Option            | Type                          | Default            | Description                                                                                     |
| ----------------- | ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `provider`        | `'google'\|'github'\|'auth0'\|'oidc'` | required   | `google`/`github` ship endpoint presets; `auth0`/`oidc` use OIDC discovery.                     |
| `issuer`          | `string`                      | —                  | Required for `auth0`/`oidc` (unless full `endpoints` are given). Discovery document is cached 1 h. |
| `endpoints`       | `Partial<OAuthEndpoints>`     | —                  | Manual overrides (`authorizationEndpoint`, `tokenEndpoint`, `userinfoEndpoint`, `jwksUri`, `issuer`). Win over presets/discovery. |
| `clientId`        | `string`                      | required           | OAuth client id.                                                                                 |
| `clientSecret`    | `string`                      | —                  | Optional for public PKCE-only clients.                                                           |
| `redirectUri`     | `string`                      | required           | Absolute callback URL registered with the provider.                                             |
| `scopes`          | `string[]`                    | provider default   | `openid profile email` (OIDC) / `read:user` (GitHub).                                           |
| `cookieSecret`    | `string`                      | required           | ≥ 32 bytes; HMAC-signs the state cookie.                                                        |
| `cookieName`      | `string`                      | `axiomify_oauth`   | State cookie name.                                                                              |
| `stateTtlSeconds` | `number`                      | `600`              | Lifetime of a login attempt.                                                                    |
| `verifyIdToken`   | `boolean`                     | `true`             | Verify ID tokens via JWKS. Disable only for providers without a published JWKS.                 |

### Flow security

- **PKCE always on**, `S256` only. The `code_verifier` never leaves the server
  except in the token-exchange POST.
- `state` (CSRF), `code_verifier` and OIDC `nonce` are stored in a signed
  (`signCookieValue`, HMAC-SHA256), HttpOnly, `SameSite=Lax` cookie with
  `Max-Age = stateTtlSeconds`; `Secure` when `redirectUri` is https. The cookie
  is one-shot — expired on the callback response regardless of outcome.
- State comparison is constant-time; a mismatch or tampered cookie → **400**
  and the token endpoint is never contacted.
- ID tokens are verified through `JwksClient` (`iss`, `aud = clientId`, `exp`,
  `nonce`) with an asymmetric-only allowlist before their claims are trusted.
- Failures map to: state/CSRF/cookie problems → **400**, ID-token failures →
  **401**, provider outages (discovery, token exchange, userinfo) → **502/503**.

## Production requirements

- [ ] Secrets in environment variables — never in source code or config files
- [ ] Secrets ≥ 32 **bytes** (256 bits) — enforced at startup in production via `Buffer.byteLength(secret, 'utf8')`
- [ ] `accessTokenTtl` ≤ 900 seconds (15 min)
- [ ] Redis-backed `TokenStore` — `MemoryTokenStore` is per-process
- [ ] `/auth/refresh` rate-limited
- [ ] `algorithms` explicitly set — never rely on defaults in production
- [ ] API keys stored as sha256 hashes (`hashApiKeySecret`) — never plaintext
- [ ] OAuth `redirectUri` uses https so the state cookie is `Secure`
