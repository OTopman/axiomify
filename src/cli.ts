#!/usr/bin/env node
import { Command } from 'commander';
import pkg from '../package.json';
import { runBuildCommand } from './cli/build';
import { runCreateCommand } from './cli/create';
import { runDevCommand } from './cli/dev';
import { runGenerateCommand } from './cli/generate';
import { runInitCommand } from './cli/init';
import { runRoutesCommand } from './cli/routes';

const program = new Command();

program.name('axiomify').description(pkg.description).version(pkg.version);

program
  .command('dev')
  .description('Start the development server with hot-reload')
  .action(() => {
    runDevCommand();
  });

program
  .command('init')
  .description('Scaffold a new Axiomify project')
  .action(async () => {
    await runInitCommand();
  });

program
  .command('build')
  .description('Compile the project for production')
  .action(async () => {
    await runBuildCommand();
  });

program
  .command('generate')
  .description('Generate frontend client types and AST map')
  .action(async () => {
    await runGenerateCommand();
  });

program
  .command('routes')
  .description('Print a visually structured table of all registered routes')
  .action(async () => {
    await runRoutesCommand();
  });

program
  .command('create')
  .alias('add') // Allow users to type `axiomify add` as well
  .description('Interactively scaffold a new route or plugin')
  .action(async () => {
    await runCreateCommand();
  });

program.parse(process.argv);
