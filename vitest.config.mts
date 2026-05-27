import { defineConfig } from 'vitest/config';
import path from 'path';

// Resolve @axiomify/* package names to their TypeScript source so tests
// run directly against src/ without requiring a prior `npm run build`.
// Without this, packages that import '@axiomify/core' resolve to dist/
// (the path listed in package.json exports) which doesn't exist in a
// fresh clone and causes 21 test files to fail at import time.
const packages = [
  'auth', 'cli', 'core', 'cors', 'fingerprint', 'graphql', 'helmet',
  'logger', 'metrics', 'native', 'openapi', 'rate-limit', 'security',
  'socket.io', 'static', 'upload', 'sdk-runtime',
];
const alias = Object.fromEntries(
  packages.map((pkg) => [
    `@axiomify/${pkg}`,
    path.resolve(__dirname, `packages/${pkg}/src/index.ts`),
  ])
);

export default defineConfig({
  resolve: { alias },
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
        // CLI: child-process spawning + file scaffolding — e2e only
        'packages/cli/src/**',
        // native: uWS bindings, C++ bridge, SO_REUSEPORT cluster — real sockets needed
        'packages/native/src/**',
        // upload: multipart streaming via busboy — real HTTP needed
        'packages/upload/src/**',
        // Type-only declarations
        'packages/core/src/types.ts',
        'packages/native/src/uws.d.ts',
      ],
      thresholds: {
        lines:      95,
        statements: 95,
        functions:  95,
        // Branch threshold is lower: remaining uncovered branches are defensive
        // fallbacks (Zod v3 compat, ?? on hot paths, dead Kahn paths). Forcing
        // 95% would require contrived tests that exist only to satisfy the metric.
        branches:   85,
      },
      reporter: ['text', 'json', 'html'],
    },
  },
});
