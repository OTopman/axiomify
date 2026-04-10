---
'@axiomify/express': minor
'@axiomify/fastify': minor
'@axiomify/openapi': minor
'axiomify-app': minor
'@axiomify/logger': minor
'@axiomify/upload': minor
'@axiomify/core': minor
'@axiomify/hapi': minor
'@axiomify/http': minor
'@axiomify/cli': minor
---

**Feature: Route-Level Plugins & System Stabilization**

- **@axiomify/core**: Introduced a route-level plugin system (`app.registerPlugin()`) for targeted middleware execution. Enforced strict generics on `addHook()` and activated runtime response validation.
- **@axiomify/logger**: Re-engineered payload interception on the `onPreHandler` hook for accurate `durationMs` tracking and reliable outgoing response logging.
- **@axiomify/hapi**: Disabled default payload parsing to restore native stream compatibility for file uploads.
- **@axiomify/upload**: Hardened the busboy pipeline against unhandled promise rejections during stream failures and race conditions.
- **@axiomify/cli**: Standardized dynamic `externals` resolution across `build`, `dev`, and `routes` commands to prevent bundling external adapters.
- **@axiomify/openapi**: Cleaned up legacy generator code and improved optional schema handling.
