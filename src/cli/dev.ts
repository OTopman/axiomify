import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export async function runDevCommand() {
  console.log('🔄 Starting Axiomify in Watch Mode...');

  const cwd = process.cwd();
  const tempEntryPath = path.join(cwd, '.axiomify-dev.ts');

  const entryCode = `
    import { _internal_bootstrap } from 'axiomify';
    _internal_bootstrap();
  `;
  fs.writeFileSync(tempEntryPath, entryCode);

  // 1. Locate the absolute path of the tsx loader
  // This ensures it works even if the user hasn't installed tsx locally
  let tsxPath: string;
  try {
    tsxPath = require.resolve('tsx/dist/loader.mjs');
  } catch (e) {
    // Fallback if the loader path structure changes in future versions
    tsxPath = 'tsx';
  }

  const child = spawn(
    'node',
    [
      '--import',
      tsxPath, // Use the absolute path to the loader
      '--no-warnings',
      '--watch', // Native Node 23 watcher
      '.axiomify-dev.ts',
    ],
    {
      stdio: 'inherit',
      shell: true,
      cwd,
      env: {
        ...process.env,
        NODE_NO_SOURCE_MAPS: '1',
      },
    },
  );

  const cleanup = () => {
    if (fs.existsSync(tempEntryPath)) {
      try {
        fs.unlinkSync(tempEntryPath);
      } catch {}
    }
    process.exit(0);
  };

  child.on('close', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
