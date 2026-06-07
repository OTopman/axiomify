# @axiomify/openapi

## 6.3.0

### Minor Changes

- 959e7b5: Axiomify Studio: A complete control plane web interface (`/studio`) featuring:
  - **Interactive SDK Playground**: Running client code securely inside sandboxed child processes with autocomplete.
  - **WebSocket & API Traffic Interceptor**: A unified Analytics panel replacing separate traffic/metrics tabs with real-time SVG sparklines.
  - **Real-time Server Metrics**: Integrated telemetry including active WebSocket room and connection statistics.
  - **OpenAPI Interactive Contracts**: Analyzer and quality auditor for routes.
  - **Error Logs Observer**: High-performance streaming logger.
  - **Automatic Type Coercion**: Schema validation automatically coerces parameters (query, params, body) before evaluation.
  - **Security & Stability Hardening**: Static server path traversal mitigation, process signal cleanup fixes, and request concurrency deadlocks resolved.

### Patch Changes

- Updated dependencies [959e7b5]
  - @axiomify/core@6.3.0
