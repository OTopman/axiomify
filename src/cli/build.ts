import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { scanAndRegisterRoutes } from '../scanner';
import { generateOpenApiDocument } from '../openapi';
import type { AxiomifyConfig } from '../core/types';

export async function runBuildCommand() {
  const cwd = process.cwd();
  const srcDir = path.join(cwd, 'src');
  const outDir = path.join(cwd, 'dist');
  const routesDir = path.join(srcDir, 'routes');
  const configPath = path.join(cwd, 'axiomify.config.ts');

  console.log('🏗️  Building Axiomify project for production...');

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  try {
    // 1. Load User Config (if exists)
    let config: AxiomifyConfig = {};
    if (fs.existsSync(configPath)) {
      const importedConfig = await import(path.join('file://', configPath));
      config = importedConfig.default || {};
    }

    // 2. Pre-load routes
    await scanAndRegisterRoutes({ routesDir: config.routesDir || routesDir });

    // 3. Generate static OpenAPI with custom config
    const openApiDoc = generateOpenApiDocument(config);

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'openapi.json'),
      JSON.stringify(openApiDoc, null, 2),
    );
    console.log('✅ Generated static openapi.json');

    // 3. Create a temporary production entry point
    // This file acts as the bridge to start the server in production without the CLI
    const prodEntryPath = path.join(srcDir, '.axiomify-entry.ts');
    const entryCode = `
      import { _internal_bootstrap } from 'axiomify';
      _internal_bootstrap();
    `;
    fs.writeFileSync(prodEntryPath, entryCode);

    // 4. Execute the high-speed esbuild compilation
    await build({
      entryPoints: [prodEntryPath],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(outDir, 'server.js'),
      // Exclude Node built-ins and our framework from the bundle to keep it light
      external: ['express', 'fastify', 'axiomify', 'zod'],
      minify: true,
      sourcemap: true,
    });

    // Clean up the temporary entry point
    fs.unlinkSync(prodEntryPath);

    console.log('\n🚀 Build successful!');
    console.log('📦 Output directory: ./dist');
    console.log(
      '▶️  Run `node dist/server.js` to start the production server.',
    );
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}
