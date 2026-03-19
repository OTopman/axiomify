#!/usr/bin/env node
import { Command } from 'commander';
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { spawn } from 'child_process';
import { Project, TypeFormatFlags } from 'ts-morph';

// package.json
var package_default = {
  version: "0.0.1"};

// src/core/registry.ts
var RouteRegistry = class {
  routes = [];
  /**
   * Adds a discovered route to the internal array.
   */
  register(route) {
    this.routes.push(route);
  }
  /**
   * Retrieves all registered routes.
   * Useful for the Server Adapters and OpenAPI generation.
   */
  getAllRoutes() {
    return this.routes;
  }
  /**
   * Clears the registry (crucial for hot-reloading in dev mode)
   */
  clear() {
    this.routes = [];
  }
};
var registry = new RouteRegistry();

// src/scanner/index.ts
async function scanAndRegisterRoutes({
  routesDir
}) {
  const normalizedPath = routesDir.split(path.sep).join(path.posix.sep);
  const pattern = path.posix.join(normalizedPath, "**/*.ts");
  const files = await fg(pattern, { absolute: true });
  let routeCount = 0;
  for (const file of files) {
    try {
      const mod = await import(file);
      const config = mod.default;
      if (!config || !config.method || !config.path || !config.handler) {
        console.warn(
          `[axiomify] Skipped invalid route file: ${file}. Ensure it uses 'export default route(...)'.`
        );
        continue;
      }
      const relativeDir = path.dirname(path.relative(routesDir, file));
      const tag = relativeDir === "." || relativeDir === "" ? "default" : relativeDir.split(path.sep)[0];
      registry.register({
        filePath: file,
        tag,
        config
      });
      routeCount++;
    } catch (error) {
      console.error(`[axiomify] Failed to load route from ${file}:`, error);
    }
  }
  return routeCount;
}
function convertToOpenApiPath(expressPath) {
  return expressPath.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
}
function generateOpenApiDocument() {
  const openApiRegistry = new OpenAPIRegistry();
  const routes = registry.getAllRoutes();
  for (const route of routes) {
    const { method, path: path5, request, response } = route.config;
    openApiRegistry.registerPath({
      method: method.toLowerCase(),
      path: convertToOpenApiPath(path5),
      tags: [route.tag],
      summary: `${method} ${path5}`,
      request: request ? {
        params: request.params,
        query: request.query,
        headers: request.headers,
        body: request.body ? {
          content: {
            "application/json": { schema: request.body }
          }
        } : void 0
      } : void 0,
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": { schema: response }
          }
        }
      }
    });
  }
  const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: package_default.version,
      title: "Axiomify API",
      description: "Auto-generated API documentation"
    }
  });
}

// src/cli/build.ts
async function runBuildCommand() {
  const cwd = process.cwd();
  const srcDir = path.join(cwd, "src");
  const outDir = path.join(cwd, "dist");
  const routesDir = path.join(srcDir, "routes");
  console.log("\u{1F3D7}\uFE0F  Building Axiomify project for production...");
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  try {
    await scanAndRegisterRoutes({ routesDir });
    const openApiDoc = generateOpenApiDocument();
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "openapi.json"),
      JSON.stringify(openApiDoc, null, 2)
    );
    console.log("\u2705 Generated static openapi.json");
    const prodEntryPath = path.join(srcDir, ".axiomify-entry.ts");
    const entryCode = `
      import { bootstrap } from 'axiomify/server/bootstrap';
      bootstrap({ mode: 'production' });
    `;
    fs.writeFileSync(prodEntryPath, entryCode);
    await build({
      entryPoints: [prodEntryPath],
      bundle: true,
      platform: "node",
      target: "node18",
      outfile: path.join(outDir, "server.js"),
      // Exclude Node built-ins and our framework from the bundle to keep it light
      external: ["express", "fastify", "axiomify", "zod"],
      minify: true,
      sourcemap: true
    });
    fs.unlinkSync(prodEntryPath);
    console.log("\n\u{1F680} Build successful!");
    console.log("\u{1F4E6} Output directory: ./dist");
    console.log(
      "\u25B6\uFE0F  Run `node dist/server.js` to start the production server."
    );
  } catch (error) {
    console.error("\u274C Build failed:", error);
    process.exit(1);
  }
}
function runDevCommand() {
  console.log("\u{1F504} Starting Axiomify in Watch Mode...");
  const entryCode = `
    import { bootstrap } from 'axiomify/server/bootstrap';
    bootstrap();
  `;
  const child = spawn(
    "npx",
    ["tsx", "watch", "--clear-screen=false", "--eval", entryCode],
    {
      stdio: "inherit",
      shell: true,
      cwd: process.cwd()
      // Run in the context of the user's project
    }
  );
  child.on("error", (err) => {
    console.error("\u274C Failed to start dev server:", err);
  });
}
async function runGenerateCommand() {
  console.log("\u{1F50D} Analyzing AST for client generation...");
  const cwd = process.cwd();
  const routes = registry.getAllRoutes();
  const project = new Project({
    tsConfigFilePath: path.join(cwd, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true
  });
  const routeFiles = routes.map((r) => r.filePath);
  project.addSourceFilesAtPaths(routeFiles);
  let typeDefinition = `// AUTO-GENERATED BY AXIOMIFY

export type AppRouter = {
`;
  const runtimeMap = {};
  for (const route of routes) {
    const sourceFile = project.getSourceFileOrThrow(route.filePath);
    const defaultExport = sourceFile.getExportAssignment(
      (d) => !d.isExportEquals()
    );
    if (!defaultExport) continue;
    const routeType = defaultExport.getExpression().getType();
    const typeText = routeType.getText(
      void 0,
      TypeFormatFlags.NoTruncation | TypeFormatFlags.InTypeAlias
    );
    const routeKey = getRouteKey(cwd, route.filePath);
    typeDefinition += `  "${routeKey}": ${typeText};
`;
    runtimeMap[routeKey] = {
      method: route.config.method,
      path: route.config.path
    };
  }
  typeDefinition += `};
`;
  fs.writeFileSync(path.join(cwd, "axiomify-env.d.ts"), typeDefinition);
  fs.writeFileSync(
    path.join(cwd, "axiomify-client.js"),
    `export const routeMap = ${JSON.stringify(runtimeMap, null, 2)};`
  );
  console.log("\u2705 Generated typed client artifacts successfully.");
}
function getRouteKey(cwd, filePath) {
  const relative = path.relative(path.join(cwd, "src", "routes"), filePath);
  return relative.replace(/\.ts$/, "").split(path.sep).join(".");
}
function runInitCommand() {
  const cwd = process.cwd();
  const routesDir = path.join(cwd, "src", "routes");
  const configFile = path.join(cwd, "axiomify.config.ts");
  console.log("\u{1F3D7}\uFE0F  Scaffolding Axiomify project...");
  if (!fs.existsSync(routesDir)) {
    fs.mkdirSync(routesDir, { recursive: true });
    console.log(`\u2705 Created directory: ${path.relative(cwd, routesDir)}`);
  }
  const sampleRoutePath = path.join(routesDir, "hello.ts");
  if (!fs.existsSync(sampleRoutePath)) {
    const sampleRoute = `import { route, z } from 'axiomify';

export default route({
  method: 'GET',
  path: '/hello',
  response: z.object({
    message: z.string(),
  }),
  handler: async () => {
    return { message: 'Welcome to Axiomify!' };
  },
});
`;
    fs.writeFileSync(sampleRoutePath, sampleRoute);
    console.log(`\u2705 Created sample route: src/routes/hello.ts`);
  }
  if (!fs.existsSync(configFile)) {
    const configTemplate = `export default {
  server: 'express',
  port: 3000,
};
`;
    fs.writeFileSync(configFile, configTemplate);
    console.log(`\u2705 Created config file: axiomify.config.ts`);
  }
  console.log(
    "\n\u{1F389} Initialization complete! Run `npx axiomify dev` to start the server."
  );
}

// src/cli.ts
var program = new Command();
program.name("axiomify").description("Zero-boilerplate, code-first API contract system").version(package_default.version);
program.command("dev").description("Start the development server with hot-reload").action(() => {
  runDevCommand();
});
program.command("init").description("Scaffold a new Axiomify project").action(() => {
  runInitCommand();
});
program.command("build").description("Compile the project for production").action(() => {
  runBuildCommand();
});
program.command("generate").description("Generate frontend client types and AST map").action(() => {
  runGenerateCommand();
});
program.parse(process.argv);
//# sourceMappingURL=cli.mjs.map
//# sourceMappingURL=cli.mjs.map