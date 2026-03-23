import fs from 'fs';
import path from 'path';
import prompts from 'prompts';
import pc from 'picocolors';
import { createJiti } from 'jiti';

export async function runCreateCommand() {
  console.log(pc.cyan('\n📦 Axiomify Resource Generator\n'));

  const cwd = process.cwd();
  let routesDir = 'src/routes';

  // Attempt to read custom routes directory from config
  const configPath = path.join(cwd, 'axiomify.config.ts');
  if (fs.existsSync(configPath)) {
    const jiti = createJiti(path.join(cwd, 'index.js'));
    const importedConfig = await jiti.import(configPath, { default: true });
    const config = (importedConfig as any)?.default || importedConfig;
    if (config?.routesDir) routesDir = config.routesDir;
  }

  const response = await prompts([
    {
      type: 'text',
      name: 'endpoint',
      message: 'What is the endpoint path? (e.g., /users or /posts/:id)',
      validate: (value) =>
        value.startsWith('/') ? true : 'Path must start with a slash (/)',
    },
    {
      type: 'select',
      name: 'method',
      message: 'Which HTTP method?',
      choices: [
        { title: 'GET', value: 'GET' },
        { title: 'POST', value: 'POST' },
        { title: 'PUT', value: 'PUT' },
        { title: 'DELETE', value: 'DELETE' },
      ],
    },
  ]);

  if (!response.endpoint) return;

  // Format the file path (e.g., /users/:id -> src/routes/users/_id.ts)
  const safeFileName = response.endpoint
    .replace(/^\//, '') // Remove leading slash
    .replace(/:([a-zA-Z0-9_]+)/g, '_$1') // Convert :id to _id for valid filenames
    .replace(/\//g, path.sep); // Convert slashes to OS-specific separators

  const finalPath = path.join(cwd, routesDir, `${safeFileName || 'index'}.ts`);
  const finalDir = path.dirname(finalPath);

  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }

  const boilerplate = `import { route, z } from 'axiomify';

        export default route({
        method: '${response.method}',
        path: '${response.endpoint}',
        request: {
            // Uncomment and define to enforce payload validation
            // body: z.object({}),
            // query: z.object({}),
            // params: z.object({}),
        },
        response: z.object({
            success: z.boolean()
        }),
        handler: async (ctx) => {
            return { success: true };
        },
        });
        `;

  if (fs.existsSync(finalPath)) {
    console.log(pc.red(`⚠️  File already exists at ${finalPath}`));
    return;
  }

  fs.writeFileSync(finalPath, boilerplate);
  console.log(
    pc.green(
      `\n✨ Created ${pc.bold(response.method)} route at ${pc.bold(path.relative(cwd, finalPath))}\n`,
    ),
  );
}
