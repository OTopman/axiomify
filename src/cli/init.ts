import fs from "fs";
import path from "path";

/**
 * Scaffolds a new Axiomify project in the current working directory.
 */
export function runInitCommand() {
  const cwd = process.cwd();
  const routesDir = path.join(cwd, "src", "routes");
  const configFile = path.join(cwd, "axiomify.config.ts");

  console.log("🏗️  Scaffolding Axiomify project...");

  // 1. Create the routes directory
  if (!fs.existsSync(routesDir)) {
    fs.mkdirSync(routesDir, { recursive: true });
    console.log(`✅ Created directory: ${path.relative(cwd, routesDir)}`);
  }

  // 2. Write a sample route file
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
    console.log(`✅ Created sample route: src/routes/hello.ts`);
  }

  // 3. Write the default config file
  if (!fs.existsSync(configFile)) {
    const configTemplate = `export default {\n  server: 'express',\n  port: 3000,\n};\n`;
    fs.writeFileSync(configFile, configTemplate);
    console.log(`✅ Created config file: axiomify.config.ts`);
  }

  console.log(
    "\n🎉 Initialization complete! Run `npx axiomify dev` to start the server.",
  );
}
