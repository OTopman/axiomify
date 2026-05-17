/**
 * Shared helper for commands that need to load the user's Axiomify app
 * without booting an HTTP listener.
 *
 * The user's entry file is compiled to a temp CommonJS bundle and required;
 * we inspect either a named `app` export or a `default` export. If the entry
 * file calls `adapter.listen()` unconditionally (i.e. NOT guarded by
 * `if (require.main === module)`), the require() will start a real server
 * and hang the CLI command — a 5-second timeout warns the user with the
 * specific fix.
 */
import * as esbuild from 'esbuild';
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import { getUserExternals } from './externals';

export interface LoadedApp {
  app: any;
  /** Cleanup callback — removes the temp build directory. Always call it. */
  cleanup: () => Promise<void>;
}

export async function loadApp(entry: string): Promise<LoadedApp> {
  const entryPath = path.resolve(process.cwd(), entry);
  const tempDir = path.resolve(process.cwd(), '.axiomify');
  const tempPath = path.join(tempDir, 'inspect.cjs');

  const userExternals = getUserExternals(process.cwd());

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: tempPath,
    external: [...new Set([...userExternals, 'node:*'])],
    // Silence esbuild's own progress chatter — the CLI command above is
    // responsible for its own user-facing output.
    logLevel: 'error',
  });

  try {
    delete require.cache[require.resolve(tempPath)];
  } catch {
    /* first load */
  }

  // Side-effect warning. If the entry file's top-level code calls
  // `adapter.listen()`, requiring the bundle starts a server and hangs the
  // CLI. We can't reliably static-detect that, but we can give the user a
  // diagnostic timeout.
  const hangTimer = setTimeout(() => {
    process.stderr.write(
      '\n' +
        pc.yellow('⚠  CLI inspection is taking longer than expected.') +
        '\n   Your entry file may be starting a server unconditionally.\n' +
        '   Wrap the listen() call in ' +
        pc.cyan('if (require.main === module) { ... }') +
        ' so it only runs when executed directly.\n\n',
    );
  }, 5_000);
  hangTimer.unref();

  let mod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require(tempPath);
  } finally {
    clearTimeout(hangTimer);
  }

  const app = mod.app ?? mod.default;
  if (!app || typeof app.registeredRoutes === 'undefined') {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      'Could not find an exported Axiomify instance.\n' +
        'Ensure your entry file exports the app:\n' +
        '  export const app = new Axiomify();\n' +
        'or:\n' +
        '  export default app;',
    );
  }

  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  return { app, cleanup };
}
