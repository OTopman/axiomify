import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { prompt } from 'enquirer';
import pc from 'picocolors';
import { execa } from 'execa';

const DEV_COMMAND_BY_PM: Record<InitAnswers['packageManager'], string> = {
  npm: 'npm run dev',
  pnpm: 'pnpm dev',
  yarn: 'yarn dev',
};

type InitAnswers = {
  projectName: string;
  description: string;
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

  const questions: any[] = [];

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

  const answers = (await prompt(questions)) as InitAnswers;
  const projectName = targetDir || answers.projectName;
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

  const pkgJson: any = {
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
      '@axiomify/core': 'latest',
      '@axiomify/express': 'latest',
      '@axiomify/helmet': 'latest',
      '@axiomify/cors': 'latest',
      '@axiomify/logger': 'latest',
      '@axiomify/security': 'latest',
      '@axiomify/rate-limit': 'latest',
      '@axiomify/fingerprint': 'latest',
    },
    devDependencies: {
      typescript: '^6.0.0',
      '@types/node': '^22.0.0',
      '@axiomify/cli': 'latest',
    },
  };

  if (answers.useEslint) {
    pkgJson.devDependencies = {
      ...pkgJson.devDependencies,
      eslint: '^8.57.0',
      prettier: '^3.0.0',
      'eslint-config-prettier': '^9.0.0',
      'eslint-plugin-prettier': '^5.0.0',
      '@typescript-eslint/eslint-plugin': '^7.0.0',
      '@typescript-eslint/parser': '^7.0.0',
    };
    pkgJson.scripts.lint = 'eslint . --ext .ts';
    pkgJson.scripts['lint:fix'] = 'eslint . --ext .ts --fix';
    pkgJson.scripts.format = 'prettier --write .';

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

  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
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

  const indexTs = `
import { Axiomify } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { useHelmet } from '@axiomify/helmet';
import { useCors } from '@axiomify/cors';
import { useLogger } from '@axiomify/logger';
import { useSecurity } from '@axiomify/security';
import { useRateLimit } from '@axiomify/rate-limit';
import { useFingerprint } from '@axiomify/fingerprint';

export const app = new Axiomify();

useHelmet(app);
useCors(app, { credentials: false });
useSecurity(app);
useRateLimit(app, { max: 100, windowMs: 60_000 });
useFingerprint(app);
useLogger(app);

app.route({
  method: 'GET',
  path: '/health',
  handler: async (_req, res) => {
    res.status(200).send({ status: 'healthy', timestamp: Date.now() }, 'System Operational');
  },
});

if (require.main === module) {
  const adapter = new ExpressAdapter(app);
  adapter.listen(3000, () => console.log('🚀 Axiomify online on port 3000'));
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
