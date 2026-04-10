import * as esbuild from 'esbuild';
import fs from 'fs/promises';
import path from 'path';
import { getUserExternals } from '../utils/externals';

export async function inspectRoutes(entry: string): Promise<void> {
  const entryPath = path.resolve(process.cwd(), entry);
  const tempPath = path.resolve(process.cwd(), '.axiomify/inspect.cjs');

  const userExternals = getUserExternals(process.cwd());

  try {
    // 1. Compile the app to a temporary CommonJS file
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: tempPath,
      external: [...new Set([...userExternals, 'node:*'])],
    });

    // 2. Clear require cache to ensure fresh load
    try {
      delete require.cache[require.resolve(tempPath)];
    } catch (e) {
      // Ignore if it's the first time and not yet in cache
    }

    // 3. Import the compiled app
    // Since the CLI is CJS, import() becomes require().
    // require() uses raw absolute paths, not file:// URLs.
    const mod = require(tempPath);
    const app = mod.app || mod.default;

    if (!app || typeof app.registeredRoutes === 'undefined') {
      console.error('❌ Error: Could not find an exported Axiomify instance.');
      console.error(
        'Ensure your entry file exports the app: `export const app = new Axiomify();`',
      );
      process.exit(1);
    }

    // 4. Format and print the routes
    console.log('\n🧭 Registered Axiomify Routes:');
    console.log('----------------------------------------------------');
    console.log(`${'METHOD'.padEnd(10)} | ${'PATH'.padEnd(30)} | VALIDATION`);
    console.log('----------------------------------------------------');

    app.registeredRoutes.forEach((route: any) => {
      const schemas = [];
      if (route.schema?.body) schemas.push('Body');
      if (route.schema?.query) schemas.push('Query');
      if (route.schema?.params) schemas.push('Params');
      if (route.schema?.response) schemas.push('Response');
      if (route.schema?.files) schemas.push('Files');

      const validationStr = schemas.length > 0 ? schemas.join(', ') : 'None';

      console.log(
        `${route.method.padEnd(10)} | ${route.path.padEnd(
          30,
        )} | ${validationStr}`,
      );
    });
    console.log('----------------------------------------------------\n');
  } catch (error) {
    console.error('❌ Failed to inspect routes:', error);
  } finally {
    // 5. Cleanup temp file
    await fs
      .rm(path.dirname(tempPath), { recursive: true, force: true })
      .catch(() => {});
  }
}
