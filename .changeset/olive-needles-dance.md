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
'@axiomify/auth': patch
'@axiomify/core': patch
'@axiomify/cors': patch
'@axiomify/cli': patch
'@axiomify/ws': patch
---

- **@axiomify/cli**: Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by running the configured response serializer on mock responses.
- **@axiomify/studio-ui**: Update Request Tester replay execution history to be displayed in descending chronological order (newest first).

