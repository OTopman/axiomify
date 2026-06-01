---
'@axiomify/core': patch
'axiomify-app': patch
'@axiomify/auth': patch
'@axiomify/cli': patch
'@axiomify/cors': patch
'@axiomify/fingerprint': patch
'@axiomify/graphql': patch
'@axiomify/helmet': patch
'@axiomify/logger': patch
'@axiomify/metrics': patch
'@axiomify/native': patch
'@axiomify/openapi': patch
'@axiomify/rate-limit': patch
'@axiomify/sdk-runtime': patch
'@axiomify/security': patch
'@axiomify/socket.io': patch
'@axiomify/static': patch
'@axiomify/upload': patch
'@axiomify/ws': patch
---

Fix spurious `ValidationError` on castable string values in query, params, and body validation.

**Problem**: HTTP query strings and URL params always arrive as strings. When a schema declared `z.number()`, the raw value `"5"` was rejected by AJV (`coerceTypes: false`) before Zod could parse it — throwing `ValidationError` for perfectly valid input.

**Fix**: Added a `preCoerce()` step that converts string values to their schema-declared types before validation. Query and params use Zod-only validation (AJV bypassed since these are always strings). Body applies pre-coercion before the AJV fast-rejection filter, preserving the ~428× error-path performance advantage.

**Coercion rules**:
- String → number/integer: `"5"` → `5`, `"0"` → `0`, `"-10"` → `-10`, `"9.99"` → `9.99` (rejects NaN)
- String → boolean: `"true"` → `true`, `"false"` → `false`
- Nested objects and arrays coerced recursively
- Non-castable values left as-is for proper `ValidationError` rejection

No application code changes required. Users who used `z.coerce.number()` as a workaround can optionally simplify to `z.number()`.
