# Changelog

All notable changes to this project will be documented in this file.

---

Here is a precise and structural draft for the `v2.0.0` changelog, focusing purely on the architectural leaps and ecosystem expansions introduced in the streaming engine branch. 

### v2.0.0 (Streaming Engine & Ecosystem Expansion)

**🚀 Major Features**
* **RAM-Safe Streaming Engine (`@axiomify/upload`)**: Introduced a native `Busboy` stream pipeline for multipart/form-data parsing. Uploads are now piped directly to the hard drive prior to handler execution, entirely bypassing RAM buffering and eliminating memory-spike crashes under load.
* **Developer CLI Ecosystem (`@axiomify/cli`)**: 
  * `axiomify init`: Rapid project scaffolding.
  * `axiomify dev`: High-speed, `esbuild`-powered development server with integrated hot-reloading.
  * `axiomify routes`: A terminal-based visual inspector that maps all registered routes and their associated Zod validation layers.
* **Auto-Generated OpenAPI (`@axiomify/openapi`)**: Added a dynamic Swagger/OpenAPI documentation generator that infers endpoints directly from the registered declarative Zod schemas.

**⚙️ Core Engine Upgrades (`@axiomify/core`)**
* **Custom Radix Tree Router**: Transitioned to a highly optimized `TrieNode` data structure for O(1) instantaneous endpoint resolution, entirely eliminating array-looping bottlenecks.
* **Deterministic Lifecycle Hooks**: Implemented an asynchronous hook manager (`preHandler`, `onError`). Plugins can now securely intercept requests and populate the `req` object *before* the validation compiler executes.
* **Centralized Error Dispatcher**: Zod schema validation failures and hook exceptions are now automatically caught, mapped safely, and returned to the client (automatically hiding stack traces in production environments).

**📦 Structural Changes**
* **Adapter Pattern Formalization**: Decoupled the routing logic from the HTTP server implementation, splitting the runtime bridges into distinct interoperable packages: `@axiomify/express`, `@axiomify/fastify`, `@axiomify/hapi`, and `@axiomify/http`.
---
