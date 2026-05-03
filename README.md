# 🌌 Axiomify


[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)


**Fastify-level speed. NestJS-level structure. Zero compromises.**

Axiomify is a high-performance, schema-first Node.js framework engineered for strict type safety and minimal runtime overhead. By unifying routing, validation, and request handling into a single declarative source of truth, Axiomify eliminates middleware fragmentation.

Built on a modular, adapter-driven architecture, Axiomify allows you to write your business logic once and deploy it across Express, Fastify, Hapi, or Native HTTP interchangeably. v4.0.0 adds enterprise-grade plugins (authentication, rate limiting, metrics, WebSockets) and comprehensive security hardening across all adapters.

---

## ⚡ Core Architecture

- **No double routing:** Each adapter uses its own router (Fastify's C++ trie, Express's router, Hapi's router, uWS's C++ native). Axiomify's radix-trie is called at most once per request — only in the 404/405 fallback. Matched routes are passed directly to the pipeline.
- **AJV-compiled validation:** Zod schemas are converted to JSON Schema 2020-12 via `z.toJSONSchema()` at startup, then compiled by AJV. Runtime validation costs ~0.06µs (valid path) vs Zod's ~0.30µs — 9.8× faster. Invalid path: 428× faster.
- **Async-minimal hook engine:** `HookManager.run()` returns synchronously for zero-handler lists; calls single handlers without async wrapping. The `onPreHandler` step is only added at route compile-time when handlers exist — no microtask boundary on routes that don't use it.
- **Adapter pattern:** Identical behaviour across all adapters — same envelope, same validation errors, same hook order, same 404/405 responses.
- **Clustered by default:** All adapters expose `listenClustered()` for multi-core scaling via Node.js cluster / uWS SO_REUSEPORT.

---

## 📦 The Workspace Ecosystem

Axiomify is distributed as a suite of 16 interoperable packages. Install only what you need:

### Core & Adapters

| Package | Description |
| :--- | :--- |
| **`@axiomify/core`** | The high-performance routing engine, lifecycle hook manager, and validation compiler. |
| **`@axiomify/cli`** | Scaffolding and development tools (`dev`, `build`, `routes` visualization). |
| **`@axiomify/express`** | The Express.js adapter bridging Axiomify's core to an Express runtime. |
| **`@axiomify/fastify`** | The Fastify adapter for maximum throughput. |
| **`@axiomify/http`** | Native Node.js `http` module adapter for zero-dependency deployments. |
| **`@axiomify/hapi`** | The Hapi.js adapter. |

### Security & Production Plugins

| Package | Description |
| :--- | :--- |
| **`@axiomify/auth`** | JWT-based authentication with automatic `req.user` population and secure token rotation via `createRefreshHandler`. |
| **`@axiomify/cors`** | Framework-agnostic CORS middleware with automatic `OPTIONS` preflight, strict validation of dangerous configurations, and proper cache headers. |
| **`@axiomify/helmet`** | Configurable HTTP security headers (HSTS, CSP, X-Frame-Options, etc.) for defense-in-depth. |
| **`@axiomify/rate-limit`** | Sliding-window rate limiting with in-memory or Redis backing. Supports distributed clustering via RedisStore. |

### Observability & Content

| Package | Description |
| :--- | :--- |
| **`@axiomify/metrics`** | Prometheus-compatible observability exporting per-route request counts and total latency, with bounded label cardinality via matched route patterns. |
| **`@axiomify/logger`** | Zero-dependency, colorized terminal logging with PII masking via `maskify-ts`. |
| **`@axiomify/openapi`** | Auto-generates Swagger/OpenAPI documentation derived directly from your Zod schemas. |
| **`@axiomify/graphql`** | Drop-in GraphQL endpoint with context factory, depth/alias limits, and a built-in GraphiQL playground. |
| **`@axiomify/upload`** | RAM-safe, stream-based multipart/form-data parsing with secure filename handling and path traversal protection. |
| **`@axiomify/static`** | Secure static file serving with directory traversal protection, streaming responses, and 304 Not Modified support. |
| **`@axiomify/ws`** | Schema-first WebSocket management with Zod validation, room/broadcast support, and per-client heartbeat. |

---

## 🚀 Comprehensive Guide

### 1. Installation & CLI Scaffolding

The fastest way to start building is using the Axiomify CLI.

```bash
# Install the CLI globally (or run via npx)
npm install -g @axiomify/cli

# Scaffold a new project
axiomify init my-api
cd my-api
npm install
```

The CLI prompts for adapter choice: **Native (uWS)**, **Fastify** *(recommended default — 10k+ req/s)*, **Express**, **Hapi**, or **Node HTTP**.

The CLI ships with an ultra-fast esbuild development server and route visualization:

```bash
npm run dev       # Starts the high-speed hot-reloading dev server
npm run build     # Compiles the TypeScript application for production
npm run routes    # Visualizes all registered routes and their plugins
```

---

### 2. Basic Routing & Schema Validation

Axiomify routes are declarative, schema-first, and fully type-safe:

```typescript
import { Axiomify } from '@axiomify/core';
import { z } from 'zod';

const app = new Axiomify();

// Define your route with inline Zod schemas
app.route({
  method: 'POST',
  path: '/users/:id/profile',

  // TypeScript automatically infers req.params, req.body, req.query types
  schema: {
    params: z.object({ id: z.string() }),
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
    response: z.object({ ok: z.boolean() }),
  },

  handler: async (req, res) => {
    // ✅ req.params, req.body are type-safe
    const { id } = req.params;
    const { name, email } = req.body;

    // Your business logic here...

    return res.send({ ok: true });
  },
});

// Serve on Fastify (or Express, Hapi, HTTP)
import { FastifyAdapter } from '@axiomify/fastify';
new FastifyAdapter(app).listen(3000);

// Swap adapters without touching route definitions:
// import { ExpressAdapter } from '@axiomify/express';
// import { HapiAdapter } from '@axiomify/hapi';
// import { HttpAdapter } from '@axiomify/http';
```

---

### 3. Plugins: Authentication, Rate Limiting, CORS

Plugins allow you to add cross-cutting concerns to specific routes:

```typescript
import { createAuthPlugin, createRefreshHandler } from '@axiomify/auth';
import { useCors } from '@axiomify/cors';
import { createRateLimitPlugin } from '@axiomify/rate-limit';

const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!, // min 32 chars; a shorter secret emits a runtime warning
  algorithms: ['HS256'], // algorithm is pinned — tokens signed with another alg are rejected
  // getToken: (req) => req.cookies?.access_token ?? null, // override default Bearer extraction
});

// Dedicated refresh-token endpoint: exchanges a valid refresh token for a fresh access token.
const refreshTokens = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessTokenTtl: 900,          // 15 minutes, seconds
  refreshTokenTtl: 60 * 60 * 24 * 30, // 30 days
});

app.route({
  method: 'POST',
  path: '/auth/refresh',
  plugins: [rateLimitByIP],
  handler: refreshTokens,
});

// Register CORS for all routes
useCors(app, { origin: ['https://trusted.example.com'] });

// Create a rate limiter: 100 requests per 15 minutes
const rateLimitByIP = createRateLimitPlugin({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  keyExtractor: (req) => {
    const fwd = req.headers['x-forwarded-for'];
    const raw = Array.isArray(fwd) ? fwd[0] : fwd;
    return raw?.split(',')[0].trim() || req.ip;
  },
});

// Apply rate limiting to a specific route
app.route({
  method: 'POST',
  path: '/auth/login',
  plugins: [rateLimitByIP, requireAuth],
  schema: { /* ... */ },
  handler: async (req, res) => {
    // req.user is automatically populated if auth middleware passes
    return res.send({ user: req.user });
  },
});
```

---

### 4. File Uploads: Stream-Based, RAM-Safe

Traditional Node.js frameworks buffer file uploads into RAM, causing massive memory spikes and crashes under load. Axiomify's `@axiomify/upload` package uses a native Busboy stream pipeline to pipe multipart data directly to the hard drive, bypassing RAM entirely:

```typescript
import { useUpload } from '@axiomify/upload';

const app = new Axiomify();

// Register the upload hook once — it activates for any route that declares a `files` schema.
useUpload(app);

app.route({
  method: 'POST',
  path: '/avatar',
  plugins: [requireAuth],
  schema: {
    files: {
      avatar: {
        autoSaveTo: './uploads/avatars',
        accept: ['image/jpeg', 'image/png'],
        maxSize: 5 * 1024 * 1024, // 5MB
        // Optional: rename uploaded files deterministically.
        // rename: (original, mimetype) => `${Date.now()}-${original}`,
      },
    },
  },
  handler: async (req, res) => {
    const file = req.files!.avatar;
    console.log(`Saved ${file.originalName} to ${file.path}`);
    return res.send({ ok: true });
  },
});
```

Filenames are automatically sanitized and validated; path traversal attempts (`../../../etc/passwd`) are rejected with a 400 error.

---

### 5. CORS: Strict Preflight Handling

CORS misconfiguration is a common source of production bugs. Axiomify's `@axiomify/cors` prevents the most dangerous mistakes:

```typescript
import { useCors } from '@axiomify/cors';

useCors(app, {
  origin: 'https://trusted.example.com', // Single origin
  credentials: true,                       // Include cookies
  exposedHeaders: ['X-RateLimit-Remaining'],
  maxAge: 86400, // 1 day
});

// ❌ This throws at startup (credentials + wildcard is spec-violating):
// useCors(app, { origin: '*', credentials: true }); // ERROR!
```

Axiomify automatically:
- Sends `OPTIONS 204 No Content` for preflight requests
- Emits `Vary: Origin` whenever the resolved origin is not `*` (critical for CDN caching)
- Echoes only allow-listed origins — requests from other origins receive no `Access-Control-Allow-Origin` header, so browsers block them per the spec
- Throws at startup on spec-violating combinations (`credentials: true` with `origin: '*'`)

---

### 6. Rate Limiting: Distributed & Flexible

```typescript
import { createRateLimitPlugin, MemoryStore, RedisStore } from '@axiomify/rate-limit';

// In-memory store (single process)
const memoryStore = new MemoryStore();

// Redis store (multi-process, PM2 clustering)
const redis = require('redis').createClient();
const redisStore = new RedisStore(redis);

const limiter = createRateLimitPlugin({
  store: memoryStore, // or redisStore for distributed apps
  windowMs: 1000, // 1 second
  maxRequests: 10,
  keyExtractor: (req) => req.user?.id || req.ip, // Rate limit by user ID or IP
});

app.route({
  method: 'GET',
  path: '/api/search',
  plugins: [limiter],
  handler: async (req, res) => {
    return res.send({ results: [] });
  },
});
```

---

### 7. WebSockets: Schema-First with Zod

WebSockets in Axiomify are schema-validated and room-aware:

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';
import { useWebSockets, type WsManager } from '@axiomify/ws';
import { z } from 'zod';

const app = new Axiomify();
const adapter = new HttpAdapter(app);
const server = adapter.listen(3000);

useWebSockets(app, {
  server, // An http.Server — useWebSockets hooks into its 'upgrade' event
  path: '/ws', // Optional: only upgrade requests hitting this path
  heartbeatIntervalMs: 30_000,
  maxMessageBytes: 65_536,
  // Optional: reject upgrade unless authenticate() returns a user
  // authenticate: async (req) => verifyJwtFromHeader(req.headers.authorization),
});

const ws = app.ws!;

// Register a message type with automatic validation
ws.on(
  'chat:message',
  z.object({ text: z.string().min(1).max(1000) }),
  (client, data) => {
    // data is type-safe: { text: string }
    ws.broadcastToRoom('chat', 'chat:message', {
      userId: client.user?.id,
      text: data.text,
    });
  },
);

// Events without a schema — pass `null`
ws.on('user:typing', null, (client) => {
  ws.broadcastToRoom('chat', 'user:typing', { userId: client.user?.id });
});
```

---

### 8. Metrics & Observability

```typescript
import { useMetrics } from '@axiomify/metrics';

useMetrics(app, {
  path: '/metrics', // default
  // Optional: guard the endpoint. Return false to respond with 403.
  // protect: async (req) => req.headers['x-internal-token'] === process.env.METRICS_TOKEN,
  // Optional: pass your WsManager to include `ws_connected_clients` gauge.
  // wsManager: (app as any).ws,
});
```

The exporter uses matched **route patterns** (e.g. `/users/:id`) — never concrete URLs — to keep Prometheus cardinality bounded. Point any Prometheus scrape config at `http://localhost:3000/metrics`.

---

### 9. Graceful Shutdown & Health Checks

```typescript
import { gracefulShutdown } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';

// Health check endpoint with distributed readiness probes.
// Each check must resolve to `true` (pass) or `false` (fail / 503).
app.healthCheck('/health', {
  database: async () => db.ping(),
  redis: async () => redis.ping(),
  external: async () => !!(await fetch('https://api.example.com')).ok,
});

// Graceful shutdown: handle SIGTERM/SIGINT, drain pending requests,
// force-exit after timeoutMs if draining stalls.
const server = new HttpAdapter(app).listen(3000);
gracefulShutdown(server, {
  timeoutMs: 10_000,
  onShutdown: async () => {
    await db.disconnect();
  },
});
```

Kubernetes health checks:
```bash
curl http://localhost:3000/health # 200 OK if all pass, 503 if any fail
```

---

### 10. OpenAPI / Swagger Documentation

Auto-generate interactive Swagger docs from your Zod schemas:

```typescript
import { useOpenAPI } from '@axiomify/openapi';

useOpenAPI(app, {
  routePrefix: '/docs', // defaults to '/docs'
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'Auto-generated from Zod schemas.',
  },
});

// Swagger UI is now available at /docs
// Raw OpenAPI 3.0.3 JSON at /docs/openapi.json
```

No separate schema files — your Zod definitions *are* your spec.

---

### 11. GraphQL

Mount a fully-featured GraphQL endpoint alongside your REST routes:

```typescript
import { buildSchema } from 'graphql';
import { useGraphQL } from '@axiomify/graphql';

const schema = buildSchema(`
  type Query {
    hello: String
    user(id: ID!): User
  }
  type User {
    id: ID!
    name: String
  }
`);

useGraphQL(app, {
  schema,
  path: '/graphql',          // default
  playground: true,          // GraphiQL UI at /graphql/playground
  maxDepth: 8,               // reject deeply-nested queries
  maxAliases: 15,            // reject alias-batching abuse
  context: (req) => ({
    userId: req.headers['x-user-id'],
  }),
});
```

- **POST `/graphql`** — primary query endpoint (`{ query, variables, operationName }`)
- **GET `/graphql`** — query-string queries for introspection and tooling
- **GET `/graphql/playground`** — GraphiQL 3 UI (disable with `playground: false`)
- Resolver errors follow the GraphQL spec: HTTP 200 with `{ errors: [...] }`

---

### 13. Security Headers with Helmet

```typescript
import { useHelmet } from '@axiomify/helmet';

useHelmet(app, {
  // Pass a full CSP string — or `false` to omit the header.
  contentSecurityPolicy: "default-src 'self'; script-src 'self' cdn.example.com",
  hsts: true,
  hstsMaxAge: 31_536_000, // 1 year (seconds); defaults to 15552000 (180 days)
  hstsIncludeSubDomains: true,
  xFrameOptions: 'DENY',                 // string or false
  xContentTypeOptions: 'nosniff',        // string or false
  xXssProtection: '0',                   // string or false (OWASP recommends '0')
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'geolocation=(), microphone=(), camera=()',
});
```

Every header defaults to a safe value — pass `false` on any field to opt out. HSTS is off by default (opt-in via `hsts: true`) to avoid breaking local HTTP development.

---

### 14. Structured Logging with PII Masking

```typescript
import { useLogger } from '@axiomify/logger';

useLogger(app, {
  level: 'info', // 'debug' | 'info' | 'warn' | 'error'
  sensitiveFields: ['password', 'authorization', 'cardNumber', 'cvv'],
});
```

`useLogger` emits one JSON line per request (on `onRequest` / `onPostHandler` / `onError`), automatically masking any header or payload field whose key matches `sensitiveFields`. Request duration is tracked via `req.state.startTime` and included on every response log.

---

### 15. Static File Serving

```typescript
import { serveStatic } from '@axiomify/static';
import path from 'path';

serveStatic(app, {
  prefix: '/public',                          // URL prefix
  root: path.join(__dirname, '..', 'public'), // absolute filesystem root
});
```

Streams responses (never buffers full files into RAM), resolves MIME types from extension, and containment-checks every resolved path against `root` — traversal attempts like `/public/../../etc/passwd` return 404.

---

### 16. Lifecycle Hooks

Hooks run globally across every route. They are the extension point behind every plugin in this document:

```typescript
app.addHook('onRequest',     (req, res) => { /* runs before routing */ });
app.addHook('onPreHandler',  (req, res, match) => { /* route is matched; validation hasn't run yet */ });
app.addHook('onPostHandler', (req, res, match) => { /* handler has sent a response */ });
app.addHook('onError',       (err, req, res) => { /* handler / hook threw */ });
app.addHook('onClose',       (req, res) => { /* always fires last, even on error */ });
```

If any hook or plugin calls `res.send()` before the handler runs, the handler is skipped and `onPostHandler` still fires so logging and metrics see the response.

---

### 17. Route Groups & Global Rate Limiting

```typescript
import { useRateLimit } from '@axiomify/rate-limit';

// Apply rate limiting to *every* route via the onPreHandler hook.
useRateLimit(app, { windowMs: 60_000, max: 1000 });

// Share prefix + plugins across a cluster of routes.
app.group('/api/v1', { plugins: [requireAuth] }, (v1) => {
  v1.route({ method: 'GET', path: '/me', handler: async (req, res) => res.send(req.user) });

  v1.group('/admin', { plugins: [requireAdmin] }, (admin) => {
    admin.route({ method: 'DELETE', path: '/users/:id', handler: deleteUser });
  });
});
```

Group prefixes are normalized (no double slashes, no trailing slash), and plugins inherit through every level of nesting.

---

### 18. Custom Response Envelope

By default every `res.send(data, message?)` is wrapped in `{ status, message, data }`. Override the envelope globally:

```typescript
app.setSerializer((data, message, statusCode, isError, req) => ({
  ok: !isError,
  requestId: req?.id,
  data,
  ...(message ? { message } : {}),
}));
```

`sendRaw(payload, contentType?)` bypasses the serializer and writes the payload verbatim — use it for HTML, binary, or already-encoded JSON.

---

## 🔒 Security by Default

Axiomify v4.0.0 hardens all adapters against common Node.js vulnerabilities:

- **Prototype Pollution Prevention**: All JSON payloads are sanitized to strip `__proto__`, `constructor`, and `prototype` keys
- **Path Traversal Defense**: Filenames and file paths use `path.resolve()` + `startsWith()` containment
- **CORS Spec Compliance**: Dangerous configurations (e.g., `credentials: true` + `origin: '*'`) throw at startup instead of silently failing
- **JWT Algorithm Pinning**: Auth plugin enforces a single algorithm and warns on weak secrets
- **Multibyte UTF-8 Safety**: HTTP adapter uses proper Buffer concatenation, never mixes strings and buffers
- **Type Safety**: All route handlers are fully type-safe by default; no implicit `any`

---

## 📊 Testing & Coverage

Axiomify ships with comprehensive test coverage:

```bash
npm test                  # Run all tests (121 tests across 26 files)
npm run coverage          # Generate a V8 coverage report
```

All tests are written in Vitest and run in parallel.

---

## 🚀 Performance

### Benchmark results (autocannon · 100 connections · pipelining 10 · 12 s · Node 22)

| Server | Req/s | Avg lat | p99 | vs bare Node.js |
|---|---:|---:|---:|---:|
| Node.js http (bare) | 27,800 | 36ms | 54ms | — |
| Fastify 5 (bare) | 27,065 | 36ms | 56ms | — |
| **Axiomify Native (uWS)** | **50,493** | **20ms** | **41ms** | **+81%** |
| Axiomify + Fastify | 10,487 | 95ms | 180ms | — |
| Axiomify + HTTP | 9,965 | 100ms | 191ms | — |

The native adapter beats bare Node.js and bare Fastify because:
- uWS resolves routes in native C++ — no JS routing overhead per request
- Every response is `cork()`'d into a single TCP `send()` syscall
- Pre-serialised 404/405/413/500 responses (zero `JSON.stringify` on error paths)
- Status line cache eliminates per-response string allocation

### Multi-core scaling (90% linear efficiency)

| Adapter | 1 core | 4 cores | 8 cores |
|---|---:|---:|---:|
| Native (uWS) | 50k | **~182k** | **~363k** |
| Fastify | 10.5k | **~38k** | **~75k** |
| HTTP | 10k | **~36k** | **~72k** |

```typescript
// All adapters support listenClustered()
const adapter = new NativeAdapter(app, { port: 3000, workers: 4 });
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} died (code=${code})`),
});
```

### Validation: Fastify-grade AJV compilation

Axiomify uses the same validation approach as Fastify: Zod schemas are converted to JSON Schema at startup via Zod v4's native `z.toJSONSchema()`, then compiled with AJV 2020-12. At runtime, the compiled validator runs in ~0.06µs vs ~0.30µs for Zod `safeParse` — and 428× faster on invalid input (AJV collects errors in 0.12µs vs Zod's 49µs).

Zod transforms (`.default()`, `.coerce.*`, `.transform()`) are applied via `schema.parse()` after AJV validates the structure — correctness is never sacrificed for performance.

---

## 📚 Examples

See `/examples` for complete runnable applications:

- `examples/native-server.ts` — Native uWS adapter with clustering and rate limiting
- `examples/secure-server.ts` — Full security stack: Helmet, CORS, JWT auth with revocation, rate limiting
- `examples/express-server.ts` — Express adapter with lifecycle hooks
- `examples/openapi-server.ts` — Auto-generated Swagger UI
- `examples/native-zod-server.ts` — Minimal zero-dependency server
- `examples/my-app/` — Full scaffolded CLI project (output of `axiomify init`)

---

## 🤝 Contributing

We welcome contributions! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

All code is subject to:
- Strict TypeScript (`strict: true`)
- Test coverage requirements (80%+ threshold)
- ESLint + Prettier formatting
- Conventional commit messages

---

## 📄 License

MIT — see [LICENSE](./LICENSE) for details.

---

## ❓ FAQ

**Q: Can I use Axiomify with my existing Express app?**

A: Yes! Axiomify routes work seamlessly with Express via `@axiomify/express`. You can incrementally migrate routes.

**Q: Do I have to use Zod?**

A: Axiomify is schema-first and Zod is the recommended validation library. However, you can bring your own validator by implementing the `ValidationCompiler` interface.

**Q: How do I handle streaming responses?**

A: Use `res.stream(readable)` on any adapter. For Server-Sent Events, mark the route with `sse: true` and use `res.sseInit()` / `res.sseSend()` on the HTTP, Express, Fastify, or Hapi adapters. `NativeAdapter` rejects SSE routes at startup because its transport does not support them.

**Q: What about database integration?**

A: Axiomify is database-agnostic. Your route handlers can use any ORM (Prisma, TypeORM, etc.) or raw queries.

**Q: Is there an admin panel or ORM included?**

A: No — Axiomify is a low-level framework. We recommend Prisma for ORM and maintain compatibility with all ORMs.

---

**Made with ❤️ by the Axiomify team.**
