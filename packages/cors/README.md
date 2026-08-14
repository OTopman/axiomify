# @axiomify/cors

[![npm version](https://img.shields.io/npm/v/@axiomify/cors.svg)](https://npmjs.com/package/@axiomify/cors)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Framework-agnostic CORS middleware for Axiomify with strict preflight handling and safe `Vary` header management.

## Install

```bash
npm install @axiomify/cors
```

## Quick start

```typescript
import { useCors } from '@axiomify/cors';

useCors(app, {
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'],
  maxAge: 86400,
});
```

## Options

| Option                 | Type                                               | Default                                                                       | Description                                                                                                         |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `origin`               | `boolean \| string \| RegExp \| Array \| Function` | `'*'`                                                                         | Allowed origins. `true` = reflect all, `false` = block all, string = exact match, function = async custom logic.    |
| `methods`              | `string[]`                                         | `['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']`                      | Allowed HTTP methods.                                                                                               |
| `allowedHeaders`       | `string[]`                                         | Reflects `Access-Control-Request-Headers`, else `Content-Type, Authorization` | Allowed request headers. When unset, reflects the requested headers, falling back to `Content-Type, Authorization`. |
| `exposedHeaders`       | `string[]`                                         | `[]`                                                                          | Headers exposed to the browser.                                                                                     |
| `credentials`          | `boolean`                                          | `false`                                                                       | Send `Access-Control-Allow-Credentials: true`.                                                                      |
| `maxAge`               | `number`                                           | `86400`                                                                       | Preflight cache duration in seconds (`Access-Control-Max-Age`).                                                     |
| `optionsSuccessStatus` | `number`                                           | `204`                                                                         | Status code for preflight responses.                                                                                |
| `preflightContinue`    | `boolean`                                          | `false`                                                                       | Pass preflight to the next handler instead of responding.                                                           |
| `allowPrivateNetwork`  | `boolean`                                          | `false`                                                                       | Emit `Access-Control-Allow-Private-Network: true` for private network access.                                       |
| `varyOnRequestHeaders` | `boolean`                                          | `true`                                                                        | Append `Access-Control-Request-Headers` to `Vary`.                                                                  |
| `strictPreflight`      | `boolean`                                          | `false`                                                                       | Reject `OPTIONS` preflights that are missing an `Origin` header with `400`.                                         |

## Dynamic origin

```typescript
useCors(app, {
  origin: async (requestOrigin) => {
    if (!requestOrigin) return false; // non-browser request
    const allowed = await db.allowedOrigins.findOne({ origin: requestOrigin });
    return !!allowed;
  },
  credentials: true,
});
```

## Behavior

- **Preflight:** `OPTIONS` requests receive `Access-Control-Allow-*` headers and a `204 No Content` response automatically — no route registration needed.
- **Vary header:** `Origin` is appended to `Vary` whenever the origin is not `*`. This prevents CDNs from caching a CORS response for one origin and serving it to another.
- **Startup validation:** `credentials: true` combined with `origin: true` (reflect-all) or `origin: '*'` throws at startup. Both are equivalent to letting any site make authenticated cross-origin requests (CWE-942), so credentialed CORS requires an explicit allowlist (string, array, `RegExp`, or function).
- **Reflect-all safety:** with `origin: true`, a missing `Origin` header or a literal `null` origin (sandboxed iframes, `data:`/`file:` documents) is **not** reflected — no `Access-Control-Allow-Origin` is sent for those opaque origins.
- **Non-browser requests:** Requests without an `Origin` header pass through without any CORS headers.
- **Unanchored RegExp origins:** a `RegExp` origin that is not anchored with `^`/`$` is auto-anchored (with a console warning) to prevent partial-match bypasses such as `attacker-domain.com`.
