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
  // Keep all workspace packages external. In particular, bundling core pulls
  // the native adapter's platform binaries into the CLI tarball through
  // commands that inspect user applications. Consumers already install core
  // as a normal dependency, so duplicating it provides no runtime benefit.
  external: [/^@axiomify\//, 'uWebSockets.js'],
  noExternal: ['commander'],
});
