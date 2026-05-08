# @axiomify/helmet

HTTP security headers for Axiomify. Sets sensible defaults for HSTS, CSP, X-Frame-Options, and 12 other headers in a single call.

## Install

```bash
npm install @axiomify/helmet
```

## Quick start

```typescript
import { useHelmet } from '@axiomify/helmet';

useHelmet(app); // all defaults — safe for most production apps
```

## With custom options

```typescript
useHelmet(app, {
  contentSecurityPolicy: "default-src 'self'; script-src 'self' https://cdn.example.com; img-src 'self' data:",
  hsts: true,
  hstsMaxAge: 31_536_000,          // 1 year
  hstsIncludeSubDomains: true,
  hstsPreload: true,
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'geolocation=(), camera=(), microphone=()',
  removeHeaders: ['X-Powered-By', 'Server'],
});
```

## Options

| Option | Default | Description |
|---|---|---|
| `contentSecurityPolicy` | `"default-src 'self'"` | `Content-Security-Policy` header value. Set `false` to omit. |
| `hsts` | `false` | Enable `Strict-Transport-Security`. Off by default to avoid breaking local HTTP dev. |
| `hstsMaxAge` | `15_552_000` (180 days) | HSTS `max-age` in seconds. |
| `hstsIncludeSubDomains` | `true` | Include `includeSubDomains` directive. |
| `hstsPreload` | `false` | Include `preload` directive (submit to browser preload list separately). |
| `xFrameOptions` | `'SAMEORIGIN'` | `X-Frame-Options`. `'DENY'`, `'SAMEORIGIN'`, or `false`. |
| `xContentTypeOptions` | `'nosniff'` | `X-Content-Type-Options`. |
| `xXssProtection` | `'0'` | `X-XSS-Protection`. OWASP recommends `'0'` to disable the buggy browser filter. |
| `referrerPolicy` | `'no-referrer'` | `Referrer-Policy`. |
| `permissionsPolicy` | `'...'` | `Permissions-Policy`. Restricts camera, microphone, geolocation by default. |
| `crossOriginEmbedderPolicy` | `'require-corp'` | `Cross-Origin-Embedder-Policy`. |
| `crossOriginOpenerPolicy` | `'same-origin'` | `Cross-Origin-Opener-Policy`. |
| `crossOriginResourcePolicy` | `'same-origin'` | `Cross-Origin-Resource-Policy`. |
| `originAgentCluster` | `'?1'` | `Origin-Agent-Cluster`. Isolates the origin into its own agent cluster. |
| `xDnsPrefetchControl` | `'off'` | `X-DNS-Prefetch-Control`. |
| `xDownloadOptions` | `'noopen'` | `X-Download-Options` (IE-only). |
| `xPermittedCrossDomainPolicies` | `'none'` | `X-Permitted-Cross-Domain-Policies`. |
| `xRobotsTag` | `false` | `X-Robots-Tag`. Set to `'noindex, nofollow'` for private APIs. |
| `removeHeaders` | `[]` | Headers to remove from responses (e.g. `['X-Powered-By', 'Server']`). |
| `removePoweredBy` | `true` | Remove `X-Powered-By` header. |

## Set to `false` to disable any header

```typescript
useHelmet(app, {
  crossOriginEmbedderPolicy: false, // disable if using cross-origin iframes/resources
  xFrameOptions: false,             // disable if embedding in iframes intentionally
});
```

## Headers set by default

```
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 0
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Permitted-Cross-Domain-Policies: none
```

HSTS is **not** set by default — enable it explicitly once your domain is fully HTTPS.
