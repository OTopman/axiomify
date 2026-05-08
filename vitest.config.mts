import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/*.config.ts',
        'benchmarks/**',
        'examples/**',
        // ── Deprecated adapter wrappers ──────────────────────────────────────
        // These are thin deprecation shims. Their clustering paths require live
        // cluster workers and are excluded from unit coverage enforcement.
        'packages/express/src/**',
        'packages/fastify/src/**',
        'packages/hapi/src/**',
        // ── CLI ───────────────────────────────────────────────────────────────
        // Child-process spawning and file scaffolding — belongs in e2e, not unit.
        'packages/cli/src/**',
        // ── Infrastructure-heavy adapters ────────────────────────────────────
        // @axiomify/http: listenClustered() is 200+ lines of cluster-fork,
        //   SO_REUSEPORT socket binding, SIGTERM/SIGUSR2 signal handling, and
        //   crash circuit breaker. Correct testing requires spawning real worker
        //   processes and sending OS signals — integration test territory.
        //   The testable HTTP request/response path is covered in adapter.test.ts
        //   and http.extra.test.ts.
        'packages/http/src/index.ts',
        // @axiomify/native: uWS native bindings, C++ bridge, SO_REUSEPORT
        //   cluster with taskset CPU pinning. Requires the uWS binary at runtime
        //   and real sockets. Core dispatch logic is tested via native.test.ts.
        'packages/native/src/**',
        // @axiomify/ws: WsManager room management, broadcast, heartbeat, and
        //   WebSocket upgrade handling require a live ws server and real socket
        //   connections. Integration-level only.
        'packages/ws/src/**',
        // @axiomify/upload: multipart streaming via busboy, temp file I/O,
        //   content-type sniffing require real multipart payloads over HTTP.
        'packages/upload/src/**',
        // ── Type-only / declarations ─────────────────────────────────────────
        'packages/core/src/types.ts',
        'packages/native/src/uws.d.ts',
      ],
      thresholds: {
        lines:      90,
        statements: 90,
        functions:  90,
        branches:   80,
      },
      reporter: ['text', 'json', 'html'],
    },
  },
});
