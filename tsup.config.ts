import { defineConfig } from "tsup";

export default defineConfig({
  // Define our distinct entry points
  entry: {
    index: 'src/index.ts', // Core exports (route, z, adapters)
    cli: 'src/cli.ts', // The executable CLI
    client: 'src/client.ts', // The frontend Proxy generator
  },
  // Output both ES Modules and CommonJS
  format: ['cjs', 'esm'],
  // Auto-generate .d.ts files for perfect intellisense
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false, // Set to false to prevent Node 23 .map crashes
  splitting: true, // Ensure splitting is enabled for clean chunks
  // Exclude heavy peer dependencies from the final bundle
  external: [
    'express',
    'fastify',
    'zod',
    'ts-morph',
    'commander',
    '@asteasolutions/zod-to-openapi',
  ],
});
