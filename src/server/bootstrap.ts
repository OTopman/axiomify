import fs from 'fs';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { createExpressApp } from '../adapters/express';
import { createFastifyApp } from '../adapters/fastify';
import { registry } from '../core/registry';
import { generateOpenApiDocument } from '../openapi';
import { scanAndRegisterRoutes } from '../scanner';

/**
 * Initializes and starts the Axiomify server.
 * Optimized for both Express and Fastify runtimes.
 */
export async function bootstrap(
  options: { port?: number; routesDir?: string } = {},
) {
  const configPath = path.join(process.cwd(), 'axiomify.config.ts');

  // 1. Set intelligent defaults
  let config = { server: 'express', port: 3000, routesDir: 'src/routes' };

  // 2. Override defaults with user config
  if (fs.existsSync(configPath)) {
    const importedConfig = await import(configPath);
    config = { ...config, ...importedConfig.default };
  }

  const PORT = Number(options.port || process.env.PORT || config.port);

  // 3. Resolve the custom routes directory
  const resolvedRoutesDir =
    options.routesDir || path.join(process.cwd(), config.routesDir);

  console.log('🚀 Starting Axiomify engine...');
  console.log(`📂 Scanning for routes in: ${resolvedRoutesDir}`);

  // 4. Execute the fast-glob discovery
  registry.clear();
  const routeCount = await scanAndRegisterRoutes({
    routesDir: resolvedRoutesDir,
  });
  console.log(`✅ Discovered and registered ${routeCount} route(s).`);
  if (routeCount === 0) {
    console.warn(
      '⚠️ No routes found. Create a file like src/routes/hello.ts to get started.',
    );
  }

  // 4. Initialize Adapter and Documentation
  const openApiDoc = generateOpenApiDocument();

  if (config.server === 'fastify') {
    // Fastify-specific initialization
    const app = await createFastifyApp();

    // Use the @fastify/express bridge to support swagger-ui-express
    await app.register(require('@fastify/express'));
    (app as any).use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

    // Fastify .listen() expects a configuration object
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n✨ Axiomify (Fastify) is running!`);
  } else {
    // Express-specific initialization
    const app = createExpressApp();

    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

    // Express .listen() expects port and callback
    app.listen(PORT, () => {
      console.log(`\n✨ Axiomify (Express) is running!`);
    });
  }

  console.log(`🔗 Local API: http://localhost:${PORT}`);
  console.log(`📚 Swagger UI: http://localhost:${PORT}/docs\n`);
}
