---
'@axiomify/fingerprint': minor
'@axiomify/sdk-runtime': minor
'@axiomify/rate-limit': minor
'@axiomify/socket.io': minor
'@axiomify/security': minor
'@axiomify/graphql': minor
'@axiomify/metrics': minor
'@axiomify/openapi': minor
'@axiomify/helmet': minor
'@axiomify/logger': minor
'@axiomify/native': minor
'@axiomify/static': minor
'@axiomify/upload': minor
'@axiomify/auth': minor
'@axiomify/core': minor
'@axiomify/cors': minor
'@axiomify/cli': minor
'@axiomify/ws': minor
---

Hardened security posture, new authorization primitives, and automatic resource cleanup across the framework.
 
**Core**: Route conflict detection (`routeConflict`), strict schema guard (`strictSchema`), DI container sealed post-bootstrap, production error masking, `req.state` write-once immutability, and `setNotFoundHandler` / `setMethodNotAllowedHandler` as first-class APIs.
 
**WebSockets**: Room authorization via `beforeJoin` hook and `allowlist` pattern with default-deny posture. Opt-in per-message sanitization via `@axiomify/security`.
 
**Upload**: Automatic temp-file cleanup (`autoCleanup`), explicit `req.cleanup()`, and `req.uploadedFiles` tracking.
 
**CLI**: `sdk generate` now ingests AsyncAPI 2.x specs automatically alongside OpenAPI and GraphQL.
 
**Auth**: HS256 secret minimum enforced at 32 bytes (RFC 7518 §3.2) at plugin registration.
 
**Security**: NoSQL pattern set extended, ReDoS hardening on sanitizer, prototype pollution option documented.
 
**Native**: Startup warning when `trustProxy` is enabled without a `proxyIpValidator`.
 
