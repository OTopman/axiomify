#!/usr/bin/env node
import { Command } from 'commander';
import pkg from '../package.json';
import { buildProject } from './commands/build';
import { runCheck } from './commands/check';
import { devServer } from './commands/dev';
import { runDoctor } from './commands/doctor';
import { initProject } from './commands/init';
import { runMigrate } from './commands/migrate';
import { emitOpenApi } from './commands/openapi';
import { inspectRoutes, RoutesOptions } from './commands/routes';
import { scaffoldRoute } from './commands/scaffold';

const program = new Command();

program
  .name('axiomify')
  .description('The official CLI for the Axiomify framework')
  // Read version from package.json so `axiomify --version` always matches the
  // published package rather than a stale hardcoded string.
  .version(pkg.version);

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
  .description('Inspect and list all registered HTTP + WebSocket routes')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .option('--json', 'Emit machine-readable JSON instead of the formatted table', false)
  .option(
    '-m, --method <list>',
    'Comma-separated list of methods to include (e.g. GET,POST,WS)',
  )
  .option(
    '-f, --filter <pattern>',
    'Path filter — substring match, or glob with "*" (e.g. /api/v1/*)',
  )
  .option(
    '-s, --sort <by>',
    'Sort routes by "method" or "path"',
    'path',
  )
  .action((entry: string, options: RoutesOptions) =>
    inspectRoutes(entry, options),
  );

program
  .command('openapi')
  .description('Generate the OpenAPI spec from the app and emit it')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .option(
    '-o, --output <file>',
    'Write the spec to this file path instead of stdout',
  )
  .option('--format <fmt>', 'Output format: "json" (default) or "yaml"', 'json')
  .option('--minify', 'Minified JSON (single line). Ignored for yaml.', false)
  .option('--title <title>', 'Override info.title in the generated spec')
  // Renamed from `--version` to dodge commander's global `--version` flag,
  // which short-circuits subcommand parsing.
  .option('--spec-version <version>', 'Override info.version in the generated spec')
  .action(
    (
      entry: string,
      options: {
        output?: string;
        format?: 'json' | 'yaml';
        minify?: boolean;
        title?: string;
        specVersion?: string;
      },
    ) =>
      emitOpenApi(entry, {
        ...options,
        // Map the CLI flag name (`spec-version` → camel `specVersion`) onto
        // the internal `version` field that emitOpenApi() expects.
        version: options.specVersion,
      }),
  );

program
  .command('check')
  .description('Run a static production-readiness audit against the app')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .action(runCheck);

program
  .command('doctor')
  .description('Diagnose the host environment (Node, uWS, ports, dep drift)')
  .action(runDoctor);

// `scaffold` is a parent command with subcommands; the only subcommand
// today is `route`, but the shape leaves room for `scaffold plugin`,
// `scaffold module`, etc. in v5.1+ (see docs/v5.1-roadmap.md).
const scaffold = program
  .command('scaffold')
  .description('Generate boilerplate (routes, modules, plugins)');

scaffold
  .command('route <method> <path>')
  .description('Create a new route file under src/routes/')
  .option('--auth', 'Include `requireAuth` plugin and import', false)
  .option('--rate-limit', 'Include a default rate-limit plugin', false)
  .option('--dry-run', 'Print the generated source without writing', false)
  .option('--force', 'Overwrite the file if it already exists', false)
  .option('--dir <dir>', 'Directory under cwd to create the file in', 'src/routes')
  .action(
    (
      method: string,
      routePath: string,
      options: {
        auth?: boolean;
        rateLimit?: boolean;
        dryRun?: boolean;
        force?: boolean;
        dir?: string;
      },
    ) => scaffoldRoute(method, routePath, options),
  );

program
  .command('migrate')
  .description('v5 → v6 codemod: merge meta: fields into schema:, fix routePrefix → prefix, etc')
  .option('--dry-run', 'Show the unified diff without writing', false)
  .option('--report-only', 'Print a migration report and exit; do not write', false)
  .option('--dir <dir>', 'Directory to scan recursively', 'src')
  .action((options: { dryRun?: boolean; reportOnly?: boolean; dir?: string }) =>
    runMigrate(options),
  );

program.parse(process.argv);
