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
        '**/*.config.ts',
        'benchmarks/**',
        'examples/**',
        // 'packages/cli/**',
        // 'packages/express/**',
        // 'packages/fastify/**',
        // 'packages/hapi/**',
        // 'packages/openapi/**'
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 65,
        statements: 50,
      },
      reporter: ['text', 'json', 'html'],
    },
  },
});