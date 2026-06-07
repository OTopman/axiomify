---
'@axiomify/core': minor
'axiomify-app': minor
'@axiomify/auth': minor
'@axiomify/cli': minor
'@axiomify/cors': minor
'@axiomify/fingerprint': minor
'@axiomify/graphql': minor
'@axiomify/helmet': minor
'@axiomify/logger': minor
'@axiomify/metrics': minor
'@axiomify/native': minor
'@axiomify/openapi': minor
'@axiomify/rate-limit': minor
'@axiomify/sdk-runtime': minor
'@axiomify/security': minor
'@axiomify/socket.io': minor
'@axiomify/static': minor
'@axiomify/upload': minor
'@axiomify/ws': minor
'@axiomify/studio-ui': minor
---

Axiomify Studio: A complete control plane web interface (`/studio`) featuring:
- **Interactive SDK Playground**: Running client code securely inside sandboxed child processes with autocomplete.
- **WebSocket & API Traffic Interceptor**: A unified Analytics panel replacing separate traffic/metrics tabs with real-time SVG sparklines.
- **Real-time Server Metrics**: Integrated telemetry including active WebSocket room and connection statistics.
- **OpenAPI Interactive Contracts**: Analyzer and quality auditor for routes.
- **Error Logs Observer**: High-performance streaming logger.
- **Automatic Type Coercion**: Schema validation automatically coerces parameters (query, params, body) before evaluation.
- **Security & Stability Hardening**: Static server path traversal mitigation, process signal cleanup fixes, and request concurrency deadlocks resolved.
