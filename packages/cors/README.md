# @axiomify/cors

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

| Option | Type | Default | Description |
|---|---|---|---|
| `origin` | `boolean \| string \| RegExp \| Array \| Function` | `false` | Allowed origins. `true` = reflect all, `false` = block all, string = exact match, function = async custom logic. |
| `methods` | `string[]` | `['GET','HEAD','PUT','PATCH','POST','DELETE']` | Allowed HTTP methods. |
| `allowedHeaders` | `string[]` | Reflects `Access-Control-Request-Headers` | Allowed request headers. |
| `exposedHeaders` | `string[]` | `[]` | Headers exposed to the browser. |
| `credentials` | `boolean` | `false` | Send `Access-Control-Allow-Credentials: true`. |
| `maxAge` | `number` | `0` | Preflight cache duration in seconds (`Access-Control-Max-Age`). |
| `optionsSuccessStatus` | `number` | `204` | Status code for preflight responses. |
| `preflightContinue` | `boolean` | `false` | Pass preflight to the next handler instead of responding. |
| `allowPrivateNetwork` | `boolean` | `false` | Emit `Access-Control-Allow-Private-Network: true` for private network access. |
| `varyOnRequestHeaders` | `boolean` | `true` | Append `Access-Control-Request-Headers` to `Vary`. |
| `strictPreflight` | `boolean` | `false` | Reject preflights missing `Access-Control-Request-Method`. |

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
- **Startup validation:** `credentials: true` combined with `origin: true` or `origin: '*'` throws at startup — this combination violates the CORS spec and browsers will reject it.
- **Non-browser requests:** Requests without an `Origin` header pass through without any CORS headers.

## Per-route CORS

For routes with different CORS requirements, skip `useCors` and use it as a plugin:

```typescript
import { createCorsPlugin } from '@axiomify/cors';

const publicCors  = createCorsPlugin({ origin: '*' });
const privateCors = createCorsPlugin({ origin: 'https://admin.example.com', credentials: true });

app.route({ method: 'GET', path: '/public',  plugins: [publicCors],  handler: ... });
app.route({ method: 'GET', path: '/private', plugins: [privateCors], handler: ... });
```
