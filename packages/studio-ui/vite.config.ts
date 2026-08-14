import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const workspacePackage = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_AXIOMIFY_VERSION': JSON.stringify(
      workspacePackage.version,
    ),
  },
  build: {
    outDir: resolve(__dirname, '../cli/ui-dist'),
    emptyOutDir: true,
  },
});
