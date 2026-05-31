import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
  // socket.io is a peer; never bundle it. Same for the framework deps —
  // they ship separately and consumers always have them installed.
  external: [
    'socket.io',
    '@axiomify/core',
    '@axiomify/native',
    'uWebSockets.js',
  ],
  tsconfig: 'tsconfig.json',
});
