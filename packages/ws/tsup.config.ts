import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
  // Framework deps ship separately; uWS is a peer. Never bundle them.
  external: [
    '@axiomify/core',
    '@axiomify/native',
    '@axiomify/security',
    'uWebSockets.js',
  ],
  tsconfig: 'tsconfig.json',
});
