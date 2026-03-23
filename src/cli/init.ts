import fs from 'fs';
import path from 'path';

export function runInitCommand() {
  const cwd = process.cwd();
  const routesDir = path.join(cwd, 'src', 'routes');
  const configFile = path.join(cwd, 'axiomify.config.ts');

  console.log('🏗️  Scaffolding Axiomify project...');

  if (!fs.existsSync(routesDir)) {
    fs.mkdirSync(routesDir, { recursive: true });
  }

  const sampleRoutePath = path.join(routesDir, 'hello.ts');
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
  }

  if (!fs.existsSync(configFile)) {
    const configTemplate = `import { defineConfig } from 'axiomify';

    export default defineConfig({
      server: 'express',
      port: 3000,
      routesDir: 'src/routes'
    });
    `;
        fs.writeFileSync(configFile, configTemplate);
      }

  console.log('\n🎉 Initialization complete! Run `npx axiomify dev` to start.');
}
