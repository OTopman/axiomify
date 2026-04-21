import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { prompt } from 'enquirer';
import pc from 'picocolors';
import { execa } from 'execa';

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
      type: 'confirm',
      name: 'useEslint',
      message: 'Add ESLint and Prettier for code quality?',
      initial: true,
    },
    {
      type: 'confirm',
      name: 'installDeps',
      message: 'Install dependencies automatically?',
      initial: true,
    }
  );

  const answers: any = await prompt(questions);
  const projectName = targetDir || answers.projectName;
  const dir = path.resolve(process.cwd(), projectName);

  if (existsSync(dir) && !options.force && targetDir) {
    // Only check if targetDir was explicitly provided and exists
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
          pc.yellow("\n\nRe-run with '--force' if you really want to replace them.")
      );
      process.exit(1);
    }
  }

  await fs.mkdir(path.join(dir, 'src'), { recursive: true });

  const pkgJson: any = {
    name: projectName,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'axiomify dev src/index.ts',
      build: 'axiomify build src/index.ts',
      start: 'node dist/index.js',
      routes: 'axiomify routes src/index.ts',
    },
    dependencies: {
      '@axiomify/core': 'latest',
      '@axiomify/express': 'latest',
      '@axiomify/helmet': 'latest',
      '@axiomify/cors': 'latest',
      '@axiomify/logger': 'latest',
      '@axiomify/security': 'latest',
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
      eslint: '^9.0.0',
      prettier: '^3.0.0',
      'eslint-config-prettier': '^9.0.0',
      'eslint-plugin-prettier': '^5.0.0',
      '@typescript-eslint/eslint-plugin': '^7.0.0',
      '@typescript-eslint/parser': '^7.0.0',
    };
    pkgJson.scripts.lint = 'eslint . --ext .ts';
    pkgJson.scripts.format = 'prettier --write "src/**/*.ts"';

    const eslintConfig = `module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {},
};`;

    const prettierConfig = `{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}`;

    await fs.writeFile(path.join(dir, '.eslintrc.js'), eslintConfig);
    await fs.writeFile(path.join(dir, '.prettierrc'), prettierConfig);
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
    },
    include: ['src/**/*'],
  };

  const indexTs = `import { Axiomify } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { useHelmet } from '@axiomify/helmet';
import { useCors } from '@axiomify/cors';
import { useLogger } from '@axiomify/logger';
import { useSecurity } from '@axiomify/security';

export const app = new Axiomify();

// Security Hardening
useHelmet(app);
useCors(app);
useSecurity(app);
useLogger(app);

app.route({
  method: 'GET',
  path: '/health',
  handler: async (req, res) => {
    res.status(200).send({ status: 'healthy', timestamp: Date.now() }, 'System Operational');
  }
});

if (require.main === module) {
  const adapter = new ExpressAdapter(app);
  adapter.listen(3000, () => console.log('🚀 Axiomify engine online on port 3000'));
}
`;

  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  await fs.writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify(tsConfig, null, 2));
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), indexTs);

  console.log(pc.green(`\n✅ Axiomify project initialized in ${pc.bold(dir)}`));

  if (answers.installDeps) {
    console.log(pc.cyan('📦 Installing dependencies...'));
    try {
      await execa('npm', ['install'], { cwd: dir, stdio: 'inherit' });
      console.log(pc.green('✅ Dependencies installed successfully!'));
    } catch (error) {
      console.error(pc.red('❌ Failed to install dependencies. Please run "npm install" manually.'));
    }
  } else {
    console.log(pc.yellow(`\n📦 Run "cd ${projectName} && npm install" to get started.`));
  }

  console.log(pc.cyan(`\n🔥 Run "npm run dev" to start your development server!`));
}
