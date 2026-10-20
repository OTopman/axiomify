---
'@axiomify/core': minor
'@axiomify/auth': minor
'@axiomify/native': minor
'@axiomify/serverless': minor
'@axiomify/static': minor
'@axiomify/ws': minor
'@axiomify/cli': minor
'@axiomify/cache': minor
'@axiomify/compress': minor
'@axiomify/db': minor
'@axiomify/session': minor
'@axiomify/testing': minor
'@axiomify/helmet': minor
'@axiomify/observability': minor
'@axiomify/cors': minor
'@axiomify/fingerprint': minor
'@axiomify/graphql': minor
'@axiomify/jobs': minor
'@axiomify/logger': minor
'@axiomify/metrics': minor
'@axiomify/openapi': minor
'@axiomify/rate-limit': minor
'@axiomify/sdk-runtime': minor
'@axiomify/security': minor
'@axiomify/socket.io': minor
'@axiomify/studio-ui': minor
'@axiomify/upload': minor
'@axiomify/vault': minor
---

Deliver the Axiomify 7.2 release featuring Studio script IntelliSense, pre-request execution sandbox, collection batch runner, and full mobile responsiveness.

### Studio UI enhancements
- **Script Sandbox & IntelliSense**: Pre-request and test script execution in a secure sandbox with infinite loop timeout guards, and autocompletion for `$` and `axiomify` APIs.
- **Dedicated Pre-Request Timeline**: Dedicated output inspection pane displaying execution duration, console logs, and real-time mutated headers/params/env variables.
- **Environment Variables IntelliSense**: Interactive `{{variable}}` autocomplete popup across URL, header, and parameter inputs with live substitution previews.
- **Collection Batch Runner**: Modal runner to execute all requests in a collection folder sequentially with progress tracking, assertion pass/fail summaries, and latency timelines.
- **Sidebar Collapsed Tooltips**: Accessible floating tooltip badges displaying route categories and navigation labels on mouse hover and keyboard focus.
- **Full Mobile Responsiveness**: Off-canvas slide-out navigation drawer with backdrop overlay for screens `<= 768px`, compact 32×32px header search trigger, 3-pane mobile segmented control (`Routes | Request | Response`) for Request Tester and WebSocket Tester (`Routes | Composer | Traffic`), and touch-scrolling data tables.

### Framework & Runtime updates
- **Core Route Groups**: Inherit and thread scoped middleware/plugins onto nested WebSocket route definitions (`group.ws(...)`).
- **CLI & Studio Server**: Support Next.js content-hashed bundles (`/_next/`), font MIME types (`.woff2`, `.woff`, `.ttf`), and strict 404s for missing chunks.
- **SDK Runtime**: Exposed `BaseClient.prototype.request` as public to facilitate custom client extensions and contract testing without network binding.

### Documentation & Starters
- Added recipes for **Tenant-Scoped Routes** and **Webhook Signature Validation**.
- Added standalone **Serverless API Starter** (`starters/serverless-api/`) for Fetch/WinterCG runtimes.
- Added contract testing guidelines for generated SDK integration testing with `@axiomify/testing`.
