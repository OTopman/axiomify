import fs from 'fs';
import { createJiti } from 'jiti';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { createExpressApp } from '../adapters/express';
import { createFastifyApp } from '../adapters/fastify';
import { registry } from '../core/registry';
import { AxiomifyConfig } from '../core/types';
import { generateOpenApiDocument } from '../openapi';
import { scanAndRegisterRoutes } from '../scanner';
import type { RequestHandler, Request, Response, NextFunction } from 'express';

/**
 * Initializes and starts the Axiomify server.
 * Optimized for both Express and Fastify runtimes.
 */
export async function bootstrap(
  options: { port?: number; routesDir?: string } = {},
) {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'axiomify.config.ts');
  const jiti = createJiti(path.join(cwd, 'index.js'));

  let config: Partial<AxiomifyConfig> = {
    server: 'express',
    port: 3000,
    routesDir: 'src/routes',
  };

  if (fs.existsSync(configPath)) {
    // Use jiti to safely import the TS config file
    const imported = await jiti.import(configPath, { default: true });
    const rawConfig = (imported || {}) as Record<string, unknown>;
    config = {
      ...config,
      ...((rawConfig.default || rawConfig) as Partial<AxiomifyConfig>),
    };
  }

  const PORT = Number(options.port || process.env.PORT || config.port);

  // 3. Resolve the custom routes directory
  const resolvedRoutesDir =
    options.routesDir || path.join(process.cwd(), config.routesDir!);

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
  const openApiDoc = generateOpenApiDocument(config);

  if (config.server === 'fastify') {
    const app = await createFastifyApp();

    const fastifyExpress = await import('@fastify/express');
    await app.register(fastifyExpress.default || fastifyExpress);
  
   const swaggerMiddlewares: RequestHandler[] = [
     (req: Request, res: Response, next: NextFunction) => {
       if (req.url === '/' || req.url === '/index.html' || req.url === '') {
         res.setHeader('Content-Type', 'text/html');
       }
       next();
     },
     ...swaggerUi.serve,
     swaggerUi.setup(openApiDoc) as RequestHandler,
   ];

    swaggerMiddlewares.forEach((mw) => {
      app.use('/docs', mw);
    });

    if (config.engineSetup) {
      console.log('⚙️  Executing custom engineSetup hook...');
      await config.engineSetup(app);
    }

    // Fastify .listen() expects a configuration object
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n✨ Axiomify (Fastify) is running!`);
  } else {
    // Express-specific initialization
    const app = await createExpressApp(config);
    if (config.engineSetup) await config.engineSetup(app);

    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
    app.listen(PORT, () => console.log(`\n✨ Axiomify (Express) is running!`));
  }

  console.log(`🔗 Local API: http://localhost:${PORT}`);
  console.log(`📚 Swagger UI: http://localhost:${PORT}/docs\n`);
}
