import fs from 'fs/promises';
import path from 'path';

export async function initProject(targetDir: string): Promise<void> {
  const dir = path.resolve(process.cwd(), targetDir);
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });

  const pkgJson = {
    name: 'axiomify-app',
    version: '1.0.0',
    private: true,
    scripts: {
      dev: 'axiomify dev src/index.ts',
      build: 'axiomify build src/index.ts',
      start: 'node dist/index.js',
      routes: 'axiomify routes src/index.ts',
    },
    dependencies: {
      '@axiomify/core': 'latest',
      '@axiomify/express': 'latest',
    },
    devDependencies: {
      typescript: '^5.0.0',
      '@types/node': '^20.0.0',
    },
  };

  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'node',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: './dist',
    },
    include: ['src/**/*'],
  };

  const indexTs = `import { Axiomify, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';

// Exporting the app instance is required for the 'axiomify routes' CLI command
export const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/health',
  handler: async (req, res) => {
    res.status(200).send({ status: 'healthy', timestamp: Date.now() }, 'System Operational');
  }
});

// Prevent listening during CLI inspection
if (require.main === module) {
  const adapter = new ExpressAdapter(app);
  adapter.listen(3000, () => console.log('🚀 Axiomify engine online on port 3000'));
}
`;

  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(pkgJson, null, 2),
  );
  await fs.writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(tsConfig, null, 2),
  );
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), indexTs);

  console.log(`✅ Axiomify project initialized in ${dir}`);
  console.log(`📦 Run 'npm install' to install dependencies.`);
}
