---
'@axiomify/rate-limit': minor
'@axiomify/express': minor
'@axiomify/fastify': minor
'@axiomify/metrics': minor
'@axiomify/openapi': minor
'axiomify-app': minor
'@axiomify/logger': minor
'@axiomify/static': minor
'@axiomify/upload': minor
'@axiomify/auth': minor
'@axiomify/core': minor
'@axiomify/cors': minor
'@axiomify/hapi': minor
'@axiomify/http': minor
'@axiomify/cli': minor
'@axiomify/ws': minor
---


## 🚀 Axiomify Ecosystem Expansion (v3.3.0)

This update transforms Axiomify from a core routing engine into a production-ready framework by introducing a suite of high-performance, type-safe plugins and critical engine refinements.

### 📦 New Packages
* **`@axiomify/rate-limit`**: Sliding window rate limiting with Memory/Redis store support.
* **`@axiomify/auth`**: JWT-based authentication with type-safe `req.user` augmentation.
* **`@axiomify/ws`**: Schema-first WebSocket management with Zod validation and room support.
* **`@axiomify/metrics`**: Prometheus-compatible observability with an auto-generated HTML dashboard.
* **`@axiomify/static`**: Secure static file serving with directory traversal protection and streaming.
* **`@axiomify/logger`**: Zero-dependency, colorized terminal logging for enhanced developer experience.

### 🛠 Core Engine Improvements
* **Pipeline Halting**: Refactored `Axiomify.handle` to respect `res.headersSent`, allowing hooks (like Rate Limiting) to short-circuit the request lifecycle safely.
* **Streaming API**: Integrated native `stream()`, `sseInit()`, and `sseSend()` across all adapters (Express, Fastify, Hapi, HTTP).
* **Type Safety**: 
    * Hardened `AxiomifyRequest` generics to default `params` to `Record<string, string>`.
    * Added `startTime` to `RequestState` for precise high-resolution duration tracking.
    * Fixed `extractResponse` in OpenAPI generator to support both Zod schemas and Record-based status mappings.

### 🐞 Bug Fixes
* **Router**: Fixed parameter extraction order in the Radix Trie to ensure dynamic path segments are captured correctly.
* **Adapters**: Resolved `ERR_HTTP_HEADERS_SENT` issues when global hooks and route handlers overlapped.
* **Fastify**: Corrected `.listen()` overloads to handle optional callbacks without type errors.

---

### 🚦 Verification Status
* [x] `npm run build` — **PASS** (All workspaces)
* [x] `npm test` — **PASS** (34/34 tests green)
* [x] Manual verification of `/metrics` dashboard and WebSocket room broadcasting.
