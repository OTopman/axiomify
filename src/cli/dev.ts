import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function runDevCommand() {
  console.log('🔄 Starting Axiomify in Watch Mode...');

  const cwd = process.cwd();

  // 1. Read the user's config to find the custom route directory
  const configPath = path.join(cwd, 'axiomify.config.ts');
  let routesDir = 'src/routes'; // Default
  if (fs.existsSync(configPath)) {
    // We use dynamic import to read the config
    const importedConfig = await import(path.join('file://', configPath));
    if (importedConfig.default?.routesDir) {
      routesDir = importedConfig.default.routesDir;
    }
  }

  // 2. Format the watch glob based on the user's config
  // e.g., "src/routes/**/*.ts" or "app/api/**/*.ts"
  const watchGlob = path.posix.join(routesDir, '**/*.ts');

  const tempEntryPath = path.join(cwd, '.axiomify-dev.ts');
  const entryCode = `
    import { _internal_bootstrap } from 'axiomify';
    _internal_bootstrap();
  `;
  fs.writeFileSync(tempEntryPath, entryCode);

  const child = spawn(
    'npx',
    [
      'tsx',
      'watch',
      '--clear-screen=false',
      '--include',
      watchGlob, // <-- Now watches their custom folder!
      '.axiomify-dev.ts',
    ],
    { stdio: 'inherit', shell: true, cwd },
  );

  // Clean up the temporary file when the server stops
  const cleanup = () => {
    if (fs.existsSync(tempEntryPath)) fs.unlinkSync(tempEntryPath);
  };

  child.on('close', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  child.on('error', (err) => {
    console.error('❌ Failed to start dev server:', err);
    cleanup();
  });
}
