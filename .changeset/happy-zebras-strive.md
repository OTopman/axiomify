---
'@axiomify/fingerprint': patch
'@axiomify/sdk-runtime': patch
'@axiomify/rate-limit': patch
'@axiomify/socket.io': patch
'@axiomify/studio-ui': patch
'@axiomify/security': patch
'@axiomify/graphql': patch
'@axiomify/metrics': patch
'@axiomify/openapi': patch
'axiomify-app': patch
'@axiomify/helmet': patch
'@axiomify/logger': patch
'@axiomify/native': patch
'@axiomify/static': patch
'@axiomify/upload': patch
'@axiomify/vault': patch
'@axiomify/auth': patch
'@axiomify/core': patch
'@axiomify/cors': patch
'@axiomify/jobs': patch
'@axiomify/cli': patch
'@axiomify/ws': patch
---


- **@axiomify/core**: Add public, type-safe `.resolve()` API to `Axiomify` class to retrieve registered DI services cleanly.
- **@axiomify/cli**: Minor robustness fix in Studio API package resolution error handling.
- **@axiomify/cli**: Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by running the configured response serializer on mock responses.
- **@axiomify/studio-ui**: Update Request Tester replay execution history to be displayed in descending chronological order (newest first).
- **@axiomify/jobs**: Introduce a resilient, type-safe distributed queue and Saga transaction workflow coordination engine with background workers and native Studio console integration.
- **@axiomify/vault**: Introduce a secure environment and configuration vault with envelope encryption, ABAC module policies, standard stream redaction, and git-guard checks.
- **@axiomify/logger**: Expand configuration options with granular opt-in controls (`includeParams`, `includeQuery`, `includeBody`, `includeResponseHeaders`, `includeState`) and safe `BigInt` log serialization.
- **@axiomify/native**: Hardened privileged internal APIs (`lockRoutes`, `getRawServer`, `registerShutdownCallback`) via strict `ADAPTER_LOCK_TOKEN` validation, simplified payload size limit rejections, and added a pre-built cached 504 Gateway Timeout response wrapper.

