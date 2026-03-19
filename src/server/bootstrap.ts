import path from "path";
import fs from "fs";
import swaggerUi from "swagger-ui-express";
import { createExpressApp } from "../adapters/express";
import { createFastifyApp } from "../adapters/fastify";
import { registry } from "../core/registry";
import { generateOpenApiDocument } from "../openapi";
import { scanAndRegisterRoutes } from "../scanner";

/**
 * Initializes and starts the Axiomify server.
 * This is used dynamically by both the `dev` and `build/start` commands.
 */
export async function bootstrap(
  options: { port?: number; routesDir?: string } = {},
) {
  // 1. Set intelligent defaults
  const PORT = options.port || process.env.PORT || 3000;

  // Default to looking for a 'src/routes' folder in the user's current working directory
  const routesDir =
    options.routesDir || path.join(process.cwd(), "src", "routes");

  console.log("🚀 Starting Axiomify engine...");
  console.log(`📂 Scanning for routes in: ${routesDir}`);

  // 2. Execute the fast-glob discovery
  registry.clear();
  const routeCount = await scanAndRegisterRoutes({ routesDir });
  console.log(`✅ Discovered and registered ${routeCount} route(s).`);

  if (routeCount === 0) {
    console.warn(
      "⚠️ No routes found. Create a file like src/routes/hello.ts to get started.",
    );
  }

  // 3. Mount the routes onto the Express Adapter
  const configPath = path.join(process.cwd(), "axiomify.config.ts");
  let config = { server: "express", port: 3000 };

  if (fs.existsSync(configPath)) {
    // Using dynamic import for the config file
    const importedConfig = await import(configPath);
    config = { ...config, ...importedConfig.default };
  }

  // Select adapter based on config
  // const app =
  //   config.server === "fastify" ? await createFastifyApp() : createExpressApp();

  const app =
    config.server === "fastify" ? await createFastifyApp() : createExpressApp();

  const openApiDoc = generateOpenApiDocument();
  // app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDoc));
  if (config.server === "fastify") {
    // Fastify requires different swagger handling usually,
    // but if using express middleware in fastify:
    await app.register(require("@fastify/express"));
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDoc));
  } else {
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDoc));
  }

  // 4. Start the HTTP server
  app.listen(PORT, () => {
    console.log(`\n✨ Server is running and strictly validated!`);
    console.log(`🔗 Local API: http://localhost:${PORT}`);
    // We will hook up the OpenAPI docs here in the next step
    console.log(`📚 Swagger UI: http://localhost:${PORT}/docs\n`);
  });
}
