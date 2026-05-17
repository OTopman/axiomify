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
        // ── CLI ───────────────────────────────────────────────────────────────
        // Child-process spawning and file scaffolding — belongs in e2e, not unit.
        'packages/cli/src/**',
        // @axiomify/native: uWS native bindings, C++ bridge, SO_REUSEPORT
        //   cluster with taskset CPU pinning. Requires the uWS binary at runtime
        //   and real sockets. Core dispatch logic is tested via native.test.ts.
        'packages/native/src/**',
        // @axiomify/upload: multipart streaming via busboy, temp file I/O,
        //   content-type sniffing require real multipart payloads over HTTP.
        'packages/upload/src/**',
        // ── Type-only / declarations ─────────────────────────────────────────
        'packages/core/src/types.ts',
        'packages/native/src/uws.d.ts',
      ],
      thresholds: {
        lines:      95,
        statements: 95,
        functions:  95,
        // Branch coverage threshold is intentionally lower than line/stmt/fn
        // coverage. The remaining uncovered branches are defensive fallbacks
        // (Zod v3 → JSON Schema compat, ?? operators on hot paths, dead-on-
        // single-module-API Kahn paths). Forcing them to 95% would require
        // contrived tests that exist only to satisfy the metric.
        branches:   85,
      },
      reporter: ['text', 'json', 'html'],
    },
  },
});
