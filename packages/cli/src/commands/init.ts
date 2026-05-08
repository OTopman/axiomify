import { prompt } from 'enquirer';
import { execa } from 'execa';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import pkg from '../../package.json';

const DEV_COMMAND_BY_PM: Record<InitAnswers['packageManager'], string> = {
  npm: 'npm run dev',
  pnpm: 'pnpm dev',
  yarn: 'yarn dev',
};

type InitAnswers = {
  projectName: string;
  description: string;
  adapter:
    | 'Native (uWS — Fastest, 50k+ req/s)'
    | 'Fastify (High-throughput, recommended)'
    | 'Express (Max ecosystem compatibility)'
    | 'Hapi (Enterprise, plugin-first)'
    | 'Node HTTP (Zero dependency)';
  useEslint: boolean;
  installDeps: boolean;
  useGit: boolean;
  packageManager: 'npm' | 'pnpm' | 'yarn';
};

export async function initProject(
  targetDir?: string,
  options: { force?: boolean } = {},
): Promise<void> {
  console.log(pc.cyan(pc.bold('\n🚀 Axiomify Project Initializer\n')));

  const questions: unknown[] = [];

  if (!targetDir) {
    questions.push({
      type: 'input',
      name: 'projectName',
      message: 'What is your project name?',
      initial: 'my-axiomify-app',
    });
  }

  questions.push(
    {
      type: 'select',
      name: 'adapter',
      message: 'Which HTTP adapter do you want to use?',
      choices: [
        'Native (uWS — Fastest, 50k+ req/s)',
        'Fastify (High-throughput, recommended)',
        'Express (Max ecosystem compatibility)',
        'Hapi (Enterprise, plugin-first)',
        'Node HTTP (Zero dependency)',
      ],
      initial: 0, // Native is the recommended default
    },
    {
      type: 'input',
      name: 'description',
      message: 'Project description',
      initial: 'A production-ready Axiomify service',
    },
    {
      type: 'confirm',
      name: 'useEslint',
      message: 'Add ESLint + Prettier + EditorConfig?',
      initial: true,
    },
    {
      type: 'select',
      name: 'packageManager',
      message: 'Preferred package manager?',
      choices: ['npm', 'pnpm', 'yarn'],
      initial: 0,
    },
    {
      type: 'confirm',
      name: 'useGit',
      message: 'Initialize a git repository?',
      initial: true,
    },
    {
      type: 'confirm',
      name: 'installDeps',
      message: 'Install dependencies automatically?',
      initial: true,
    },
  );

  const answers = (await prompt(questions as any)) as InitAnswers;
  const projectName = targetDir || answers.projectName;

  if (!projectName || projectName.trim().length === 0) {
    console.error(
      pc.red(
        '❌ A project name is required. Aborting to avoid writing into the current directory.',
      ),
    );
    process.exit(1);
  }

  if (
    // eslint-disable-next-line no-control-regex
    /[<>:"|?*\u0000-\u001f]/.test(projectName) ||
    projectName.includes('..')
  ) {
    console.error(
      pc.red(
        `❌ Invalid project name: "${projectName}". Names cannot contain path traversal or control characters.`,
      ),
    );
    process.exit(1);
  }

  const dir = path.resolve(process.cwd(), projectName);

  if (existsSync(dir) && !options.force && targetDir) {
    const targets = [
      path.join(dir, 'package.json'),
      path.join(dir, 'tsconfig.json'),
      path.join(dir, 'src', 'index.ts'),
    ];
    const collisions = targets.filter((p) => existsSync(p));
    if (collisions.length > 0) {
      console.error(
        pc.red('❌ Refusing to overwrite existing files:\n') +
          collisions.map((p) => `   - ${p}`).join('\n') +
          pc.yellow(
            "\n\nRe-run with '--force' if you really want to replace them.",
          ),
      );
      process.exit(1);
    }
  }

  await fs.mkdir(path.join(dir, 'src'), { recursive: true });

  const AXIOMIFY_VERSION = `^${pkg.version}`;

  let adapterPackage = '@axiomify/native';
  let adapterImport = "import { NativeAdapter } from '@axiomify/native';";
  let adapterInit =
    "const server = new NativeAdapter(app, { port: 3000 });\n  server.listen(() => console.log('  Axiomify Native on :3000'));";

  if (answers.adapter.includes('Fastify')) {
    adapterPackage = '@axiomify/fastify';
    adapterImport = "import { FastifyAdapter } from '@axiomify/fastify';";
    adapterInit =
      "const server = new FastifyAdapter(app);\n  await server.listen(3000);\n  console.log('  Axiomify Fastify on :3000');";
  } else if (answers.adapter.includes('Express')) {
    adapterPackage = '@axiomify/express';
    adapterImport = "import { ExpressAdapter } from '@axiomify/express';";
    adapterInit =
      "const server = new ExpressAdapter(app);\n  server.listen(3000, () => console.log('  Axiomify Express on :3000'));";
  } else if (answers.adapter.includes('Hapi')) {
    adapterPackage = '@axiomify/hapi';
    adapterImport = "import { HapiAdapter } from '@axiomify/hapi';";
    adapterInit =
      "const server = new HapiAdapter(app);\n  await server.listen(3000);\n  console.log('  Axiomify Hapi on :3000');";
  } else if (answers.adapter.includes('HTTP')) {
    adapterPackage = '@axiomify/http';
    adapterImport = "import { HttpAdapter } from '@axiomify/http';";
    adapterInit =
      "const server = new HttpAdapter(app);\n  server.listen(3000, () => console.log('  Axiomify HTTP on :3000'));";
  }

  const pkgJson: Record<string, unknown> = {
    name: projectName,
    version: '1.0.0',
    private: true,
    description: answers.description,
    scripts: {
      dev: 'axiomify dev src/index.ts',
      build: 'axiomify build src/index.ts',
      start: 'node dist/index.js',
      routes: 'axiomify routes src/index.ts',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      '@axiomify/core': AXIOMIFY_VERSION,
      [adapterPackage]: AXIOMIFY_VERSION, // Inject selected adapter
      '@axiomify/helmet': AXIOMIFY_VERSION,
      '@axiomify/cors': AXIOMIFY_VERSION,
      '@axiomify/logger': AXIOMIFY_VERSION,
      '@axiomify/security': AXIOMIFY_VERSION,
      '@axiomify/rate-limit': AXIOMIFY_VERSION,
      '@axiomify/fingerprint': AXIOMIFY_VERSION,
    },
    devDependencies: {
      typescript: '^5.4.0',
      '@types/node': '^22.0.0',
      '@axiomify/cli': AXIOMIFY_VERSION,
    },
  };

  if (answers.useEslint) {
    (pkgJson.devDependencies as Record<string, string>) = {
      ...(pkgJson.devDependencies as Record<string, string>),
      eslint: '^8.57.0',
      prettier: '^3.0.0',
      'eslint-config-prettier': '^9.0.0',
      'eslint-plugin-prettier': '^5.0.0',
      '@typescript-eslint/eslint-plugin': '^7.0.0',
      '@typescript-eslint/parser': '^7.0.0',
    };
    (pkgJson.scripts as Record<string, string>).lint = 'eslint . --ext .ts';
    (pkgJson.scripts as Record<string, string>)['lint:fix'] =
      'eslint . --ext .ts --fix';
    (pkgJson.scripts as Record<string, string>).format = 'prettier --write .';

    const eslintConfig = `module.exports = {
      root: true,
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint', 'prettier'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:prettier/recommended',
      ],
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      env: {
        node: true,
        es2022: true,
      },
    };`;

    const prettierConfig = `{
      "semi": true,
      "trailingComma": "all",
      "singleQuote": true,
      "printWidth": 100,
      "tabWidth": 2
    }`;

    await fs.writeFile(path.join(dir, '.eslintrc.cjs'), eslintConfig);
    await fs.writeFile(path.join(dir, '.prettierrc'), prettierConfig);
    await fs.writeFile(
      path.join(dir, '.prettierignore'),
      'dist\nnode_modules\ncoverage\n',
    );
    await fs.writeFile(
      path.join(dir, '.editorconfig'),
      'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n',
    );
  }

  // tsconfig uses CommonJS to match the CLI's dev/build output format (format: 'cjs').
  // The scaffolded entry file uses `require.main === module` which only works in CJS.
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
      rootDir: './src',
      types: ['node'],
    },
    include: ['src/**/*'],
  };

  const indexTs = `import { Axiomify } from '@axiomify/core';
    ${adapterImport}
    import { useHelmet } from '@axiomify/helmet';
    import { useCors } from '@axiomify/cors';
    import { useLogger } from '@axiomify/logger';
    import { useSecurity } from '@axiomify/security';
    import { useRateLimit, MemoryStore } from '@axiomify/rate-limit';
    import { useFingerprint } from '@axiomify/fingerprint';

    export const app = new Axiomify();

    useHelmet(app);
    useCors(app, { credentials: false });
    useSecurity(app);

    // PRODUCTION NOTE
    // MemoryStore is per-process. For production, swap this for a RedisStore.
    useRateLimit(app, { max: 100, windowMs: 60_000, store: new MemoryStore() });
    useFingerprint(app);
    useLogger(app);

    app.route({
      method: 'GET',
      path: '/health',
      handler: async (_req, res) => {
        res.status(200).send({ status: 'healthy' }, 'System Operational');
      },
    });

    if (require.main === module) {
      ${adapterInit}
    }
    `;

  // .gitignore — includes .axiomify (CLI temp build output) so it is never committed.
  const gitignore =
    [
      'node_modules',
      'dist',
      '.axiomify',
      '.env',
      '.env.local',
      'coverage',
      '*.log',
    ].join('\n') + '\n';

  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(pkgJson, null, 2),
  );
  await fs.writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(tsConfig, null, 2),
  );
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), indexTs);
  await fs.writeFile(path.join(dir, '.gitignore'), gitignore);

  console.log(pc.green(`\n✅ Axiomify project initialized in ${pc.bold(dir)}`));

  if (answers.useGit && !existsSync(path.join(dir, '.git'))) {
    try {
      await execa('git', ['init'], { cwd: dir });
      console.log(pc.green('✅ Git repository initialized'));
    } catch {
      console.log(pc.yellow('⚠️ Could not initialize git repository.'));
    }
  }

  if (answers.installDeps) {
    const pkgManager = answers.packageManager || 'npm';
    const installArgs = ['install'];
    console.log(pc.cyan(`📦 Installing dependencies using ${pkgManager}...`));
    try {
      await execa(pkgManager, installArgs, { cwd: dir, stdio: 'inherit' });
      console.log(pc.green('✅ Dependencies installed successfully!'));
    } catch {
      console.error(
        pc.red('❌ Failed to install dependencies. Please install manually.'),
      );
    }
  } else {
    console.log(
      pc.yellow(
        `\n📦 Run "cd ${projectName} && ${
          answers.packageManager || 'npm'
        } install" to get started.`,
      ),
    );
  }

  const devCommand = DEV_COMMAND_BY_PM[answers.packageManager || 'npm'];
  console.log(
    pc.cyan(`\n🔥 Run "${devCommand}" to start your development server!`),
  );
}
