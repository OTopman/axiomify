import { defineConfig } from 'vitest/config';
import path from 'path';

const extendedCoverage = process.env.AXIOMIFY_EXTENDED_COVERAGE === '1';

// Resolve @axiomify/* package names to their TypeScript source so tests
// run directly against src/ without requiring a prior `npm run build`.
// Without this, packages that import '@axiomify/core' resolve to dist/
// (the path listed in package.json exports) which doesn't exist in a
// fresh clone and causes 21 test files to fail at import time.
const packages = [
  'auth',
  'cache',
  'cli',
  'compress',
  'core',
  'cors',
  'db',
  'fingerprint',
  'graphql',
  'helmet',
  'logger',
  'metrics',
  'native',
  'observability',
  'openapi',
  'rate-limit',
  'security',
  'session',
  'socket.io',
  'static',
  'testing',
  'upload',
  'sdk-runtime',
  'ws',
  'vault',
  'jobs',
];
const alias = Object.fromEntries(
  packages.map((pkg) => [
    `@axiomify/${pkg}`,
    path.resolve(__dirname, `packages/${pkg}/src/index.ts`),
  ]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    // Some CLI tests spawn child processes and VMs with 5s watchdogs. Running
    // files in parallel makes those unrelated tests contend for CPU and flake
    // in CI, so keep the shared suite deterministic by default.
    maxWorkers: 1,
    fileParallelism: false,
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
        ...(!extendedCoverage
          ? [
              // These subsystems use integration/browser-style suites. Keep the
              // core 95% gate stable and report them separately in the extended
              // coverage job instead of hiding their baseline.
              'packages/cli/src/**',
              'packages/studio-ui/src/**',
            ]
          : []),
        // native: uWS bindings, C++ bridge, SO_REUSEPORT cluster — real sockets needed
        'packages/native/src/**',
        // ws: room manager built on native uWS topics — real sockets needed
        'packages/ws/src/**',
        // upload: multipart streaming via busboy — real HTTP needed
        'packages/upload/src/**',
        // Type-only declarations
        'packages/core/src/types.ts',
        'packages/native/src/uws.d.ts',
        // telemetry: requires active OTLP endpoints and dynamic SDK loading
        'packages/core/src/telemetry.ts',
        // Module re-export entry points
        'packages/*/src/index.ts',
      ],
      thresholds: extendedCoverage
        ? undefined
        : {
            lines: 95,
            statements: 95,
            functions: 95,
            branches: 85,
          },
      reporter: ['text', 'json', 'html'],
    },
  },
});
