import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import prompts from 'prompts';

export async function runInitCommand() {
  console.log(pc.bold(pc.cyan('\n🚀 Welcome to the Axiomify Setup Wizard!\n')));

  const cwd = process.cwd();
  const configFile = path.join(cwd, 'axiomify.config.ts');

  if (fs.existsSync(configFile)) {
    console.log(
      pc.yellow('⚠️  An axiomify.config.ts already exists in this directory.'),
    );
    return;
  }

  // 1. The Interactive Prompts
  const response = await prompts([
    {
      type: 'select',
      name: 'server',
      message: 'Which underlying HTTP engine would you like to use?',
      choices: [
        { title: 'Fastify (Recommended for Speed)', value: 'fastify' },
        { title: 'Express (Best Ecosystem)', value: 'express' },
      ],
      initial: 0,
    },
    {
      type: 'number',
      name: 'port',
      message: 'What port should the server run on?',
      initial: 3000,
    },
    {
      type: 'text',
      name: 'routesDir',
      message: 'Where will your routes be located?',
      initial: 'src/routes',
    },
  ]);

  // Handle Ctrl+C exit
  if (!response.server) {
    console.log(pc.red('\n❌ Setup cancelled.\n'));
    return;
  }

  // 2. Generate the Config File
  const configTemplate = `import { defineConfig } from 'axiomify';

      export default defineConfig({
        server: '${response.server}',
        port: ${response.port},
        routesDir: '${response.routesDir}'
      });
      `;

  fs.writeFileSync(configFile, configTemplate);
  console.log(pc.green(`\n✅ Created ${pc.bold('axiomify.config.ts')}`));

  // 3. Scaffold the target directory and a sample route
  const resolvedRoutesDir = path.join(cwd, response.routesDir);
  if (!fs.existsSync(resolvedRoutesDir)) {
    fs.mkdirSync(resolvedRoutesDir, { recursive: true });

    const sampleRoute = `import { route, z } from 'axiomify';

        export default route({
          method: 'GET',
          path: '/hello',
          response: z.object({ message: z.string() }),
          handler: async () => {
            return { message: 'Welcome to Axiomify!' };
          },
        });
        `;
    fs.writeFileSync(path.join(resolvedRoutesDir, 'hello.ts'), sampleRoute);
    console.log(
      pc.green(`✅ Created sample route in ${pc.bold(response.routesDir)}`),
    );
  }

  console.log(
    pc.cyan(
      `\n🎉 You're all set! Run ${pc.bold('npx axiomify dev')} to start coding.\n`,
    ),
  );
}
