#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '../package.json';
import { buildProject } from './commands/build';
import { runCheck } from './commands/check';
import { registerDbCommand } from './commands/db';
import { devServer } from './commands/dev';
import { runDoctor } from './commands/doctor';
import { initProject } from './commands/init';
import { runMigrate } from './commands/migrate';
import { emitOpenApi } from './commands/openapi';
import { inspectRoutes, RoutesOptions } from './commands/routes';
import { scaffoldRoute } from './commands/scaffold';
import { generateSdk } from './commands/sdk/generate';
import { runStudio, StudioCommandOptions } from './commands/studio';

function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.substring(1, val.length - 1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    } catch {
      // ignore
    }
  }
}

loadEnv();

const program = new Command();

program
  .name('axiomify')
  .description('The official CLI for the Axiomify framework')
  // Read version from package.json so `axiomify --version` always matches the
  // published package rather than a stale hardcoded string.
  .version(pkg.version);

// ... existing commands ...

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
  .option(
    '--watch-sdk <langs...>',
    'Target languages to automatically regenerate SDKs on changes',
  )
  .action((entry: string, options: any) => devServer(entry, options));

program
  .command('build')
  .description('Compile the application for production')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .action(buildProject);

program
  .command('routes')
  .description('Inspect and list all registered HTTP + WebSocket routes')
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .option(
    '--json',
    'Emit the machine-readable route surface (schema hashes) instead of the table',
    false,
  )
  .option(
    '--snapshot [file]',
    'Write the route surface to a baseline file (default: routes-baseline.json)',
  )
  .option(
    '--diff <baseline>',
    'Compare the current route surface against a baseline file; exit 1 on breaking changes',
  )
  .option(
    '--strict-response',
    'With --diff: treat response-schema changes as breaking instead of warnings',
    false,
  )
  .option(
    '--allow-breaking',
    'With --diff: report breaking changes but exit 0',
    false,
  )
  .option(
    '-m, --method <list>',
    'Comma-separated list of methods to include (e.g. GET,POST,WS)',
  )
  .option(
    '-f, --filter <pattern>',
    'Path filter — substring match, or glob with "*" (e.g. /api/v1/*)',
  )
  .option('-s, --sort <by>', 'Sort routes by "method" or "path"', 'path')
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
  .option(
    '--spec-version <version>',
    'Override info.version in the generated spec',
  )
  .option(
    '--validate',
    'Validate the generated spec (official OAS 3.1 schema + semantic lints); exit 1 on errors',
    false,
  )
  .option(
    '--json',
    'With --validate: emit the findings as JSON instead of the report',
    false,
  )
  .action(
    (
      entry: string,
      options: {
        output?: string;
        format?: 'json' | 'yaml';
        minify?: boolean;
        title?: string;
        specVersion?: string;
        validate?: boolean;
        json?: boolean;
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
  .option(
    '--dir <dir>',
    'Directory under cwd to create the file in',
    'src/routes',
  )
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
  .command('studio')
  .description(
    'Launch Axiomify Studio — a visual control centre for inspecting routes, schemas, hooks, and more',
  )
  .argument('[entry]', 'Entry file', 'src/index.ts')
  .option('-p, --port <port>', 'Port for the Studio server (default: 4399)')
  .option(
    '--app-url <url>',
    'Base URL for Playground SDK requests (for example http://localhost:4000)',
  )
  .option('--no-open', 'Do not auto-open the browser')
  .action((entry: string, options: StudioCommandOptions) =>
    runStudio(entry, options),
  );

program
  .command('migrate')
  .description(
    'v5 → v6 codemod: merge meta: fields into schema:, fix routePrefix → prefix, etc',
  )
  .option('--dry-run', 'Show the unified diff without writing', false)
  .option(
    '--report-only',
    'Print a migration report and exit; do not write',
    false,
  )
  .option('--dir <dir>', 'Directory to scan recursively', 'src')
  .action((options: { dryRun?: boolean; reportOnly?: boolean; dir?: string }) =>
    runMigrate(options),
  );

// `db` is a parent command that runs the project's database workflow
// (migrate / seed / generate / status) through the axiomify.db manifest.
registerDbCommand(program);

// `sdk` is a parent command for the Type-Safe SDK Generation Platform
const sdk = program
  .command('sdk')
  .description('Manage, generate, and diff type-safe SDKs');

sdk
  .command('generate')
  .description(
    'Generate type-safe SDKs from an Axiomify app, OpenAPI spec, or GraphQL schema',
  )
  .argument(
    '<input>',
    'Input file (e.g. src/index.ts, spec.json, schema.graphql)',
  )
  .requiredOption(
    '-t, --target <langs...>',
    'Target languages (e.g. typescript python)',
  )
  .option('-o, --output <dir>', 'Output directory', 'generated-sdks')
  .option('-n, --name <name>', 'Package name (e.g. my-api-sdk)')
  .option('-v, --version <version>', 'Package version (e.g. 1.0.0)')
  .option(
    '--no-runtime',
    'Do not include runtime dependencies (generate pure types)',
  )
  .option('--dry-run', 'Print generated files instead of writing them to disk')
  .action(async (input: string, options: any) => {
    await generateSdk({ input, ...options });
  });

import { registerSdkBenchmarkCommand } from './commands/sdk/benchmark';
import { registerSdkBuildCommand } from './commands/sdk/build';
import { registerSdkDiffCommand } from './commands/sdk/diff';
import { registerSdkDoctorCommand } from './commands/sdk/doctor';
import { registerSdkMigrateCommand } from './commands/sdk/migrate';
import { registerSdkPublishCommand } from './commands/sdk/publish';
import { registerSdkUpgradeCommand } from './commands/sdk/upgrade';
import { registerSdkValidateCommand } from './commands/sdk/validate';
import { registerSdkWatchCommand } from './commands/sdk/watch';

registerSdkDiffCommand(sdk);
registerSdkValidateCommand(sdk);
registerSdkBuildCommand(sdk);
registerSdkPublishCommand(sdk);
registerSdkDoctorCommand(sdk);
registerSdkBenchmarkCommand(sdk);
registerSdkWatchCommand(sdk);
registerSdkMigrateCommand(sdk);
registerSdkUpgradeCommand(sdk);

program.parse(process.argv);
