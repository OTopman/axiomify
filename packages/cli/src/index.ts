#!/usr/bin/env node
import { Command } from 'commander';
import { buildProject } from './commands/build';
import { devServer } from './commands/dev';
import { initProject } from './commands/init';
import { inspectRoutes } from './commands/routes';

const program = new Command();

program
  .name('axiomify')
  .description('The official CLI for the Axiomify framework')
  .version('1.0.0');

program
  .command('init')
  .description('Bootstrap a new Axiomify project')
  .argument('[directory]', 'Target directory')
  .option('-f, --force', 'Overwrite existing project files', false)
  .action((directory: string, options?: { force?: boolean }) =>
    initProject(directory, options),
  );

program
  .command('dev')
  .description('Start the development server with hot-reload')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .action(devServer);

program
  .command('build')
  .description('Compile the application for production')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .action(buildProject);

program
  .command('routes')
  .description('Inspect and list all registered routes in the application')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .action(inspectRoutes);

program.parse(process.argv);
