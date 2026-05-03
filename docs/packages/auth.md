# @axiomify/auth

JWT authentication and refresh-token rotation for Axiomify.

## API

- `createAuthPlugin(options)` — route plugin that validates Bearer tokens
- `createRefreshHandler(options)` — route handler that rotates refresh tokens
- `getAuthUser(req)` — retrieves the authenticated user from `req.state`
- `MemoryTokenStore` — in-process token store (testing / single-process only)

## Access token revocation

Pass `store` to `createAuthPlugin` to check the store on every request:

```typescript
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  store: redisTokenStore, // store.exists(jti) called on every request
});
```

When `store` is configured, tokens **must** have a `jti` claim. Tokens without `jti` are rejected with 401.

To revoke an access token immediately:
```typescript
await store.revoke(jti); // subsequent requests with this token → 401
```

## Refresh token rotation

`createRefreshHandler` with `store`:
- Verifies the incoming refresh token
- Calls `store.exists(jti)` — rejects if missing (revoked or never saved)
- Calls `store.revoke(jti)` — invalidates the old token
- Issues a new access token and refresh token
- Calls `store.save(newJti, refreshTtl)` — saves the new JTI

## Production notes

- Use Redis-backed `TokenStore` in production — `MemoryTokenStore` is per-process
- Set `accessTokenTtl: 900` (15 min) and `refreshTokenTtl: 2592000` (30 days)
- Rate-limit `/auth/refresh` with `@axiomify/rate-limit`
- Secrets must be ≥32 chars, loaded from environment variables only
