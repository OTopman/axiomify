# Security Policy

## Supported Versions

| Version | Supported                                                             |
| ------- | --------------------------------------------------------------------- |
| 7.x     | ✅ Latest stable; active security maintenance                         |
| 6.x     | ⚠️ Security fixes for 6 months after the 7.0 release; no new features |
| < 6.0   | ❌ Unsupported                                                        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** Instead, use GitHub's private vulnerability reporting at <https://github.com/OTopman/axiomify/security/advisories/new>, or email the maintainer directly. Reports are triaged within 72 hours.

When reporting:

- Provide a minimal reproduction (a route definition + the input that triggers the issue is ideal).
- Include the Axiomify version (`@axiomify/core` and `@axiomify/native` versions are what we usually need).
- State your disclosure timeline expectations. We default to a 90-day coordinated disclosure window.

## Known-Safe Production Configuration

Deploying Axiomify to production safely requires these constraints. Each one closes a real vulnerability class observed in framework usage at scale:

### 1. Pin JWT algorithms explicitly

```typescript
createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  algorithms: ['HS256'], // never rely on jsonwebtoken defaults
});
```

The framework rejects `'none'` unconditionally. Pinning the algorithm list defends against algorithm-confusion attacks (e.g. RS256 → HS256 with the public key).

### 2. Use a 32-byte (256-bit) JWT secret

RFC 7518 §3.2 requires HS256 keys to be ≥ 256 bits. Axiomify measures byte length:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

The framework throws in production (`NODE_ENV=production`) on secrets shorter than 32 bytes; warns in development.

### 3. Protect the `/metrics` endpoint

`@axiomify/metrics` exposes internal timing data, route paths, and aggregate counts — useful to attackers performing reconnaissance. **Always** supply a `protect:` callback:

```typescript
useMetrics(app, {
  protect: async (req) =>
    req.headers['x-internal-key'] === process.env.METRICS_KEY,
});
```

The plugin emits a `console.warn` on first request if `/metrics` is unprotected in production.

### 4. Set `maxBodySize` on the adapter

Body size enforcement happens on the actual uWS byte stream — **NOT** on the `Content-Length` header (which clients can omit via chunked transfer):

```typescript
const adapter = new NativeAdapter(app, {
  maxBodySize: 1_048_576, // 1 MiB
  // ...
});
```

The `maxBodySize` option in `@axiomify/security` checks `Content-Length` only and is a belt-and-braces supplement to the adapter-level limit, not a replacement.

### 5. Configure `trustProxy` correctly

If deploying behind a proxy you control (Nginx, ALB, Cloudflare), enable `trustProxy: true` on the adapter so `req.ip` reflects the real client IP:

```typescript
new NativeAdapter(app, { trustProxy: true });
```

If `trustProxy` is `false` and you're behind a proxy, rate limiters will key on the proxy's IP — every user shares one bucket. If `trustProxy` is `true` but you're NOT behind a proxy, clients can forge `X-Forwarded-For` to evade per-IP limits. The correct value depends on your topology.

### 6. Validate response headers from user-controlled values

`res.header(name, value)` throws on CR/LF/NUL bytes, preventing response-splitting attacks. But upstream sanitisation is still recommended — don't blindly pipe user input into header values.

### 7. Use parameterised database queries

Axiomify does not include a SQL-injection detector — the regex heuristic that shipped in 4.x was bypassable and was removed in 5.0. Parameterised queries / prepared statements at the database layer are the only real defence. ORMs (Prisma, Drizzle, Kysely) handle this for you.

## Security defaults enabled out of the box

These run automatically when the relevant plugin is registered:

- `@axiomify/native` — `res.header()` rejects CR/LF/NUL bytes (response-splitting prevention); body parser tolerates malformed percent-encoding instead of throwing 500s; stream/SSE responses bounded to 8 MiB / 1 MiB pending bytes (slow-consumer DOS prevention)
- `@axiomify/cors` — `credentials: true` + literal `origin: '*'` throws at startup
- `@axiomify/security` — prototype-pollution / null-byte / XSS sanitisation enabled by default; SQL detector removed
- `@axiomify/auth` — JWT algorithm pinning, byte-length secret validation, refresh-token rotation that survives transient store outages without logging users out
- `@axiomify/static` — `realpath()` containment check defeats path-traversal even on case-insensitive filesystems
