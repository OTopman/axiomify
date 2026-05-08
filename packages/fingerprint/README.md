# @axiomify/fingerprint

Server-side request fingerprinting for Axiomify. Generates a deterministic hash per request from IP, headers, and path for bot detection, fraud prevention, and session anomaly detection.

> **Note:** This is a server-side fingerprint for request correlation — not a replacement for client-side anti-fraud platforms like Fingerprint Pro. It operates entirely on HTTP headers and cannot access browser APIs.

## Install

```bash
npm install @axiomify/fingerprint
```

## Quick start

```typescript
import { useFingerprint } from '@axiomify/fingerprint';

useFingerprint(app, {
  includeIp: true,
  includePath: false,          // false = fingerprint is path-agnostic (good for session tracking)
  additionalHeaders: ['x-device-id', 'x-app-version'],
  trustProxyHeaders: true,     // use X-Forwarded-For when behind a proxy
});
```

After this hook runs, every request has:

```typescript
req.state.fingerprint          // string  — SHA-256 hex digest
req.state.fingerprintData      // object  — inputs that produced the hash
req.state.fingerprintConfidence // number — 0–98 weighted confidence score
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `algorithm` | `string` | `'sha256'` | Hash algorithm (`'sha256'`, `'sha512'`, `'md5'`). |
| `salt` | `string` | `''` | HMAC salt — set this to a stable secret to prevent pre-image attacks. |
| `includeIp` | `boolean` | `true` | Include client IP in the hash. |
| `includePath` | `boolean` | `false` | Include request path. Disable for cross-path session correlation. |
| `additionalHeaders` | `string[]` | `[]` | Extra request headers to include in the hash (lowercase). |
| `trustProxyHeaders` | `boolean` | `false` | Use `X-Forwarded-For` for IP extraction behind a proxy. |

## Confidence score

The confidence score (0–98) estimates how stable the fingerprint is across requests from the same client:

| Score range | Meaning |
|---|---|
| 80–98 | High confidence — IP + multiple headers matched |
| 50–79 | Medium — some headers missing or dynamic |
| 0–49 | Low — only 1–2 signals available |

## Usage in rate limiting and bot detection

```typescript
import { useFingerprint } from '@axiomify/fingerprint';
import { createRateLimitPlugin } from '@axiomify/rate-limit';

useFingerprint(app, { includeIp: true });

// Rate limit by fingerprint instead of raw IP (harder to bypass with IP rotation)
const limiter = createRateLimitPlugin({
  store: redisStore,
  windowMs: 60_000,
  max: 100,
  keyGenerator: (req) => req.state.fingerprint ?? req.ip,
});
```

## Accessing fingerprint in handlers

```typescript
app.route({
  method: 'POST',
  path: '/auth/login',
  handler: async (req, res) => {
    const { fingerprint, fingerprintConfidence } = req.state;

    if (fingerprintConfidence < 30) {
      // Very low confidence — unusual client, may want extra verification
    }

    await auditLog.write({ fingerprint, userId: req.body.email, event: 'login' });
    res.send({ ok: true });
  },
});
```
