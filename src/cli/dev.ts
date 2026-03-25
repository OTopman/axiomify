import { spawn } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

// @ts-expect-error - TS complains about import.meta in CJS, but tsup shims it automatically at build time
const require = createRequire(import.meta.url);

export async function runDevCommand() {
  console.log('🔄 Starting Axiomify in Watch Mode...');

  const cwd = process.cwd();
  const configPath = path.join(cwd, 'axiomify.config.ts');
  const tempEntryPath = path.join(cwd, '.axiomify-dev.ts');

  const entryCode = `
    import { _internal_bootstrap } from 'axiomify';
    _internal_bootstrap();
  `;
  fs.writeFileSync(tempEntryPath, entryCode);

  let tsxPath: string;
  try {
    tsxPath = require.resolve('tsx/dist/loader.mjs');
  } catch (e) {
    tsxPath = 'tsx';
  }

  // 👇 FIX: Explicitly tell Node which paths to monitor
  const watchArgs = ['--watch', '--watch-path=./src'];
  if (fs.existsSync(configPath)) {
    watchArgs.push('--watch-path=./axiomify.config.ts');
  }

  const child = spawn(
    'node',
    [
      '--import',
      tsxPath,
      '--no-warnings',
      ...watchArgs, // Inject the explicit watch paths here
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
