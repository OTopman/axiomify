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

Fix AJV validation failing with additional properties on default schemas by dynamically adjusting the `additionalProperties` mapping to match Zod's default/strict object semantics.
