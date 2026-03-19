import { build } from "esbuild";
import fs from "fs";
import path from "path";
import { scanAndRegisterRoutes } from "../scanner";
import { generateOpenApiDocument } from "../openapi";

/**
 * Compiles the Axiomify project for production deployment.
 */
export async function runBuildCommand() {
  const cwd = process.cwd();
  const srcDir = path.join(cwd, "src");
  const outDir = path.join(cwd, "dist");
  const routesDir = path.join(srcDir, "routes");

  console.log("🏗️  Building Axiomify project for production...");

  // 1. Clean the previous build
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  try {
    // 2. Pre-load routes to generate the static OpenAPI specification
    // We do this before compiling so the artifact is ready for the static server
    await scanAndRegisterRoutes({ routesDir });
    const openApiDoc = generateOpenApiDocument();

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "openapi.json"),
      JSON.stringify(openApiDoc, null, 2),
    );
    console.log("✅ Generated static openapi.json");

    // 3. Create a temporary production entry point
    // This file acts as the bridge to start the server in production without the CLI
    const prodEntryPath = path.join(srcDir, ".axiomify-entry.ts");
    const entryCode = `
      import { bootstrap } from 'axiomify/server/bootstrap';
      bootstrap({ mode: 'production' });
    `;
    fs.writeFileSync(prodEntryPath, entryCode);

    // 4. Execute the high-speed esbuild compilation
    await build({
      entryPoints: [prodEntryPath],
      bundle: true,
      platform: "node",
      target: "node18",
      outfile: path.join(outDir, "server.js"),
      // Exclude Node built-ins and our framework from the bundle to keep it light
      external: ["express", "fastify", "axiomify", "zod"],
      minify: true,
      sourcemap: true,
    });

    // Clean up the temporary entry point
    fs.unlinkSync(prodEntryPath);

    console.log("\n🚀 Build successful!");
    console.log("📦 Output directory: ./dist");
    console.log(
      "▶️  Run `node dist/server.js` to start the production server.",
    );
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}
