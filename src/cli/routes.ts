import path from 'path';
import fs from 'fs';
import { createJiti } from 'jiti';
import { scanAndRegisterRoutes } from '../scanner';
import { registry } from '../core/registry';

export async function runRoutesCommand() {
  console.log('🔍 Analyzing Axiomify routing tree...\n');

  const cwd = process.cwd();
  const configPath = path.join(cwd, 'axiomify.config.ts');
  let routesDir = 'src/routes';

  // 1. Resolve custom route directory if configured
  if (fs.existsSync(configPath)) {
    const jiti = createJiti(path.join(cwd, 'index.js'));
    const importedConfig = await jiti.import(configPath, { default: true });

    const rawConfig: any = importedConfig || {};
    const config = rawConfig.default || rawConfig;

    if (config.routesDir) {
      routesDir = config.routesDir;
    }
  }

  // 2. Execute the AST scanner (this populates the registry in-memory)
  await scanAndRegisterRoutes({ routesDir: path.join(cwd, routesDir) });
  const routes = registry.getAllRoutes();

  if (routes.length === 0) {
    console.log('⚠️  No routes found. Create a file in your routes directory.');
    return;
  }

  // 3. Format the extracted metadata for the terminal table
  const tableData = routes.map((r) => {
    const { method, path, request, plugins } = r.config;

    const expectsBody = !!request?.body;
    const expectsParams = !!request?.params;
    const expectsQuery = !!request?.query;

    const payloadDeps =
      [
        expectsBody ? 'Body' : '',
        expectsParams ? 'Params' : '',
        expectsQuery ? 'Query' : '',
      ]
        .filter(Boolean)
        .join(', ') || 'None';

    return {
      Method: method,
      Path: path,
      Payload: payloadDeps,
      Plugins: plugins ? plugins.length : 0,
      Tag: r.tag,
    };
  });

  // 4. Render
  console.table(tableData);
  console.log(`\n✅ Total Routes: ${routes.length}\n`);
}
