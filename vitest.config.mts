import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Strictly include ONLY TypeScript source files in the packages
      include: ['packages/*/src/**/*.ts'],
      // Exclude build artifacts, test files, configs, and non-core adapters
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        'packages/core/src/types.ts',
        '**/*.config.ts',
        'benchmarks/**',
        'examples/**',
        'packages/cli/**',
        'packages/express/**',
        'packages/fastify/**',
        'packages/hapi/**',
        'packages/openapi/**',
      ],
      thresholds: {
        lines: 82,
        functions: 83,
        branches: 80,
        statements: 80,
      },
      reporter: ['text', 'json', 'html'],
    },
  },
});