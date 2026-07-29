import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
  // @axiomify/db stays external: `axiomify db` imports it lazily and falls
  // back to a built-in manifest reader when it is not installed — bundling
  // it would defeat that optionality.
  external: ['@axiomify/sdk-runtime', '@axiomify/db'],
  noExternal: ['commander'],
});
