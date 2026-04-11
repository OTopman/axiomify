import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      exclude: [
        '**/dist/**', // Ignore compiled output
        'examples/**', // Ignore example apps
        'packages/cli/**', // Optional: Exclude CLI if you only want framework coverage
        '**/*.d.ts', // Ignore type declarations
        'vitest.config.ts',
        'tsup.config.ts',
      ],
    },
  },
});
