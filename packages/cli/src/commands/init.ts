import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export async function initProject(
  targetDir: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const dir = path.resolve(process.cwd(), targetDir);
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });

  // Guard against silently trashing work. The previous implementation
  // overwrote package.json / tsconfig.json / src/index.ts with no warning
  // if the target directory already held a project — a very easy footgun
  // to hit by typing `axiomify init` in the wrong shell.
  const targets = [
    path.join(dir, 'package.json'),
    path.join(dir, 'tsconfig.json'),
    path.join(dir, 'src', 'index.ts'),
  ];
  const collisions = targets.filter((p) => existsSync(p));
  if (collisions.length > 0 && !options.force) {
    console.error(
      '❌ Refusing to overwrite existing files:\n' +
        collisions.map((p) => `   - ${p}`).join('\n') +
        "\n\nRe-run with '--force' if you really want to replace them.",
    );
    process.exit(1);
  }

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
      // Keep scaffolded projects on the same TS major as the workspace
      // (^6) so types like `satisfies`, `const` type parameters, etc., don't
      // drift between the framework and user code.
      typescript: '^6.0.0',
      '@types/node': '^22.0.0',
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
