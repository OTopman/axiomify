# @axiomify/helmet

[![npm version](https://img.shields.io/npm/v/@axiomify/helmet.svg)](https://npmjs.com/package/@axiomify/helmet)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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
  contentSecurityPolicy:
    "default-src 'self'; script-src 'self' https://cdn.example.com; img-src 'self' data:",
  hsts: {
    maxAge: 31_536_000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'geolocation=(), camera=(), microphone=()',
  removeHeaders: ['X-Powered-By', 'Server'],
});
```

## Options

| Option                          | Default                                                                 | Description                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentSecurityPolicy`         | `"default-src 'self'; base-uri 'self'; frame-ancestors 'none'"`         | `Content-Security-Policy` header value (`string`). Set `false` to omit.                                                                                                      |
| `hsts`                          | `true`                                                                  | `Strict-Transport-Security`. `true` uses `max-age=15552000; includeSubDomains`; pass an object `{ maxAge?, includeSubDomains?, preload? }` to customize, or `false` to omit. |
| `xFrameOptions`                 | `'DENY'`                                                                | `X-Frame-Options`. `'DENY'`, `'SAMEORIGIN'`, or `false`.                                                                                                                     |
| `xContentTypeOptions`           | `'nosniff'`                                                             | `X-Content-Type-Options`.                                                                                                                                                    |
| `xXssProtection`                | `'0'`                                                                   | `X-XSS-Protection`. OWASP recommends `'0'` to disable the buggy browser filter.                                                                                              |
| `referrerPolicy`                | `'no-referrer'`                                                         | `Referrer-Policy`.                                                                                                                                                           |
| `permissionsPolicy`             | `'geolocation=(), microphone=(), camera=()'`                            | `Permissions-Policy`. Set `false` to omit.                                                                                                                                   |
| `crossOriginEmbedderPolicy`     | `'require-corp'`                                                        | `Cross-Origin-Embedder-Policy`. Set `false` to omit.                                                                                                                         |
| `crossOriginOpenerPolicy`       | `'same-origin'`                                                         | `Cross-Origin-Opener-Policy`. Set `false` to omit.                                                                                                                           |
| `crossOriginResourcePolicy`     | `'same-origin'`                                                         | `Cross-Origin-Resource-Policy`. Set `false` to omit.                                                                                                                         |
| `originAgentCluster`            | `true`                                                                  | `Origin-Agent-Cluster: ?1` when truthy. Isolates the origin into its own agent cluster.                                                                                      |
| `xDnsPrefetchControl`           | `'off'`                                                                 | `X-DNS-Prefetch-Control`.                                                                                                                                                    |
| `xDownloadOptions`              | `'noopen'`                                                              | `X-Download-Options` (IE-only).                                                                                                                                              |
| `xPermittedCrossDomainPolicies` | `'none'`                                                                | `X-Permitted-Cross-Domain-Policies`.                                                                                                                                         |
| `xRobotsTag`                    | `'noindex, nofollow'`                                                   | `X-Robots-Tag`. Set `false` to omit (e.g. for public, indexable sites).                                                                                                      |
| `removeHeaders`                 | `['X-Powered-By', 'Server', 'X-AspNet-Version', 'X-AspNetMvc-Version']` | Headers to remove from responses.                                                                                                                                            |
| `removePoweredBy`               | `true`                                                                  | Always include `X-Powered-By` in the removed-headers set.                                                                                                                    |

## Set to `false` to disable any header

```typescript
useHelmet(app, {
  crossOriginEmbedderPolicy: false, // disable if using cross-origin iframes/resources
  xFrameOptions: false, // disable if embedding in iframes intentionally
});
```

## Headers set by default

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=15552000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=()
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Permitted-Cross-Domain-Policies: none
X-Robots-Tag: noindex, nofollow
```

HSTS is **enabled by default** (`max-age=15552000; includeSubDomains`). If you serve over plain HTTP in local development, pass `hsts: false` to avoid pinning the browser to HTTPS. `X-Robots-Tag: noindex, nofollow` is also set by default (suited to APIs); pass `xRobotsTag: false` for public, indexable sites.

The following headers are removed by default (via `removeHeaders` / `removePoweredBy`): `X-Powered-By`, `Server`, `X-AspNet-Version`, `X-AspNetMvc-Version`.
