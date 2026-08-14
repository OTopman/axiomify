/**
 * `axiomify db <migrate|seed|generate|status>` — run a project's database
 * workflow through the `axiomify.db.json` / `axiomify.db.mjs` manifest
 * (schema v1, owned by @axiomify/db).
 *
 * Manifest resolution:
 *   1. `@axiomify/db`'s `loadDbConfig()` via lazy dynamic import — the
 *      authoritative loader, and the only one that can execute `.mjs`
 *      manifests with function commands.
 *   2. When the package is absent, a built-in fallback reads
 *      `axiomify.db.json` (shell-string commands only) so the CLI stands
 *      alone. `.mjs` manifests without the package are a clear error.
 *
 * Execution model: the CLI NEVER runs anything that is not explicitly
 * declared in the manifest. Shell strings are spawned with inherited stdio
 * and their exit code is propagated; functions are awaited.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import type { Command } from 'commander';
import { symbols } from '../utils/format';

export type DbAction = 'migrate' | 'seed' | 'generate';

const DB_ACTIONS: readonly DbAction[] = ['migrate', 'seed', 'generate'];
const MANIFEST_JSON = 'axiomify.db.json';
const MANIFEST_MJS = 'axiomify.db.mjs';

type DbCommandValue = string | ((...args: unknown[]) => unknown);

export interface LoadedManifest {
  path: string;
  format: 'json' | 'mjs';
  commands: Partial<Record<DbAction, DbCommandValue>>;
}

export interface DbCmdOptions {
  /** Print what would run without executing. */
  dryRun?: boolean;
  /** Project directory (defaults to process.cwd()) — injectable for tests. */
  cwd?: string;
}

const SUGGESTED_MANIFEST = `{
  "version": 1,
  "commands": {
    "migrate": "npx prisma migrate deploy",
    "seed": "node ./scripts/seed.mjs",
    "generate": "npx prisma generate"
  }
}`;

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

// ─── Manifest loading ────────────────────────────────────────────────────────

/**
 * Fallback loader used when @axiomify/db is not installed. Only supports
 * the JSON flavour; mirrors @axiomify/db's v1 validation rules.
 */
export async function loadManifestFallback(
  cwd: string,
): Promise<LoadedManifest | null> {
  const jsonPath = path.resolve(cwd, MANIFEST_JSON);
  const mjsPath = path.resolve(cwd, MANIFEST_MJS);
  const [hasJson, hasMjs] = await Promise.all([
    exists(jsonPath),
    exists(mjsPath),
  ]);

  if (hasJson && hasMjs) {
    throw new Error(
      `Found both ${MANIFEST_JSON} and ${MANIFEST_MJS} in ${cwd}. ` +
        'Keep exactly one manifest and delete the other.',
    );
  }
  if (hasMjs) {
    throw new Error(
      `${MANIFEST_MJS} manifests require @axiomify/db (they can export ` +
        'function commands). Install it:\n  ' +
        pc.cyan('npm install @axiomify/db') +
        `\nor convert the manifest to ${MANIFEST_JSON} with shell-string commands.`,
    );
  }
  if (!hasJson) return null;

  const raw = await fs.readFile(jsonPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid db manifest (${jsonPath}): expected an object.`);
  }
  const config = parsed as Record<string, unknown>;
  if (config.version !== 1) {
    throw new Error(
      `Invalid db manifest (${jsonPath}): unsupported version ` +
        `${JSON.stringify(config.version)}. This CLI supports schema version 1.`,
    );
  }
  const commands: Partial<Record<DbAction, DbCommandValue>> = {};
  if (config.commands !== undefined) {
    if (
      config.commands === null ||
      typeof config.commands !== 'object' ||
      Array.isArray(config.commands)
    ) {
      throw new Error(
        `Invalid db manifest (${jsonPath}): "commands" must be an object.`,
      );
    }
    for (const [name, cmd] of Object.entries(config.commands)) {
      if (!(DB_ACTIONS as readonly string[]).includes(name)) {
        throw new Error(
          `Invalid db manifest (${jsonPath}): unknown command "${name}". ` +
            `Allowed commands: ${DB_ACTIONS.join(', ')}.`,
        );
      }
      if (cmd === undefined) continue;
      if (typeof cmd !== 'string' || cmd.trim() === '') {
        throw new Error(
          `Invalid db manifest (${jsonPath}): command "${name}" must be a ` +
            'non-empty shell string (JSON manifests cannot express functions).',
        );
      }
      commands[name as DbAction] = cmd;
    }
  }
  return { path: jsonPath, format: 'json', commands };
}

/**
 * Load the db manifest: prefer @axiomify/db's loader (lazy import so the
 * CLI works when the package is absent), fall back to the built-in JSON
 * reader. Returns null when no manifest exists.
 */
export async function loadManifest(
  cwd: string,
): Promise<LoadedManifest | null> {
  let dbPkg: any;
  try {
    dbPkg = await import('@axiomify/db');
  } catch {
    dbPkg = undefined;
  }

  if (dbPkg && typeof dbPkg.loadDbConfig === 'function') {
    const loaded = await dbPkg.loadDbConfig(cwd);
    if (!loaded) return null;
    return {
      path: loaded.path,
      format: loaded.format,
      commands: loaded.config.commands ?? {},
    };
  }

  return loadManifestFallback(cwd);
}

// ─── Execution ───────────────────────────────────────────────────────────────

function runShell(command: string, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      console.error(pc.red('✗ Failed to spawn command:'), err.message);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function describeCommand(cmd: DbCommandValue): string {
  return typeof cmd === 'string'
    ? cmd
    : `[function${cmd.name ? ` ${cmd.name}` : ''}]`;
}

/**
 * Run one manifest command. Returns the process exit code instead of
 * calling process.exit() so it is directly testable; the commander action
 * wrapper assigns it to `process.exitCode`.
 */
export async function runDbAction(
  action: DbAction,
  opts: DbCmdOptions = {},
): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();

  let manifest: LoadedManifest | null;
  try {
    manifest = await loadManifest(cwd);
  } catch (err) {
    console.error(pc.red('✗ ') + (err as Error).message);
    return 1;
  }

  if (!manifest) {
    console.error(
      pc.red(
        `✗ No ${MANIFEST_JSON} or ${MANIFEST_MJS} manifest found in ${cwd}.`,
      ) +
        `\n\n  Create ${pc.cyan(MANIFEST_JSON)} to declare your database workflow:\n\n` +
        SUGGESTED_MANIFEST.replace(/^/gm, '  ') +
        '\n',
    );
    return 1;
  }

  const cmd = manifest.commands[action];
  if (cmd === undefined) {
    const configured = DB_ACTIONS.filter((a) => manifest!.commands[a]);
    console.error(
      pc.red(`✗ No "${action}" command is configured in ${manifest.path}.`) +
        (configured.length
          ? `\n  Configured commands: ${configured.map((c) => pc.cyan(c)).join(', ')}`
          : '\n  The manifest declares no commands.') +
        `\n  Add it under ${pc.cyan(`"commands": { "${action}": "..." }`)} (schema v1).`,
    );
    return 1;
  }

  if (opts.dryRun) {
    console.log(
      `${symbols.info} ${pc.bold(`db ${action}`)} ${pc.dim('(dry-run)')} would run: ` +
        pc.cyan(describeCommand(cmd)),
    );
    return 0;
  }

  if (typeof cmd === 'string') {
    console.log(`${symbols.arrow} ${pc.bold(`db ${action}`)}: ${pc.cyan(cmd)}`);
    const code = await runShell(cmd, cwd);
    if (code === 0) {
      console.log(`${symbols.ok} db ${action} completed`);
    } else {
      console.error(
        `${symbols.fail} db ${action} exited with code ${pc.bold(String(code))}`,
      );
    }
    return code;
  }

  // Function command (only reachable through @axiomify/db `.mjs` manifests).
  console.log(
    `${symbols.arrow} ${pc.bold(`db ${action}`)}: ${pc.cyan(describeCommand(cmd))}`,
  );
  try {
    const result = await cmd();
    console.log(`${symbols.ok} db ${action} completed`);
    return typeof result === 'number' ? result : 0;
  } catch (err) {
    console.error(
      `${symbols.fail} db ${action} failed: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return 1;
  }
}

// ─── Status + ORM detection ──────────────────────────────────────────────────

export interface OrmHint {
  orm: 'prisma' | 'drizzle' | 'knex';
  evidence: string;
  suggestion: Partial<Record<DbAction, string>>;
}

/** Best-effort detection of common ORM setups (used when no manifest exists). */
export async function detectOrms(cwd: string): Promise<OrmHint[]> {
  const hints: OrmHint[] = [];

  if (await exists(path.resolve(cwd, 'prisma', 'schema.prisma'))) {
    hints.push({
      orm: 'prisma',
      evidence: 'prisma/schema.prisma',
      suggestion: {
        migrate: 'npx prisma migrate deploy',
        seed: 'npx prisma db seed',
        generate: 'npx prisma generate',
      },
    });
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(cwd);
  } catch {
    /* unreadable cwd — no hints */
  }

  const drizzleConfig = entries.find((f) =>
    /^drizzle\.config\.[cm]?[jt]s$/.test(f),
  );
  if (drizzleConfig) {
    hints.push({
      orm: 'drizzle',
      evidence: drizzleConfig,
      suggestion: {
        migrate: 'npx drizzle-kit migrate',
        generate: 'npx drizzle-kit generate',
      },
    });
  }

  const knexfile = entries.find((f) => /^knexfile\.[cm]?[jt]s$/.test(f));
  if (knexfile) {
    hints.push({
      orm: 'knex',
      evidence: knexfile,
      suggestion: {
        migrate: 'npx knex migrate:latest',
        seed: 'npx knex seed:run',
      },
    });
  }

  return hints;
}

export async function dbStatus(opts: DbCmdOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();

  let manifest: LoadedManifest | null;
  try {
    manifest = await loadManifest(cwd);
  } catch (err) {
    console.error(pc.red('✗ ') + (err as Error).message);
    return 1;
  }

  console.log();
  console.log(pc.bold('  🗄  Axiomify db status'));
  console.log();

  if (manifest) {
    console.log(
      `  ${symbols.ok} Manifest: ${pc.cyan(path.relative(cwd, manifest.path) || manifest.path)} ` +
        pc.dim(`(${manifest.format})`),
    );
    console.log();
    for (const action of DB_ACTIONS) {
      const cmd = manifest.commands[action];
      console.log(
        `    ${pc.bold(action.padEnd(8))} ` +
          (cmd !== undefined
            ? pc.cyan(describeCommand(cmd))
            : pc.dim('not configured')),
      );
    }
    console.log();
    return 0;
  }

  console.log(
    `  ${symbols.warn} No ${pc.cyan(MANIFEST_JSON)} or ${pc.cyan(MANIFEST_MJS)} manifest found in ${cwd}`,
  );

  const hints = await detectOrms(cwd);
  if (hints.length > 0) {
    console.log();
    for (const hint of hints) {
      console.log(
        `  ${symbols.info} Detected ${pc.bold(hint.orm)} ` +
          pc.dim(`(${hint.evidence})`),
      );
    }
    const first = hints[0];
    const suggested = {
      version: 1,
      commands: first.suggestion,
    };
    console.log();
    console.log(
      `  Suggested ${pc.cyan(MANIFEST_JSON)} for ${pc.bold(first.orm)}:`,
    );
    console.log();
    console.log(JSON.stringify(suggested, null, 2).replace(/^/gm, '  '));
  } else {
    console.log();
    console.log(`  Create ${pc.cyan(MANIFEST_JSON)} to declare your workflow:`);
    console.log();
    console.log(SUGGESTED_MANIFEST.replace(/^/gm, '  '));
  }
  console.log();
  return 0;
}

// ─── Command registration ────────────────────────────────────────────────────

export function registerDbCommand(program: Command): void {
  const db = program
    .command('db')
    .description(
      'Run the project database workflow declared in axiomify.db.json / .mjs',
    );

  for (const action of DB_ACTIONS) {
    db.command(action)
      .description(`Run the "${action}" command from the db manifest`)
      .option('--dry-run', 'Print what would run without executing', false)
      .action(async (options: { dryRun?: boolean }) => {
        process.exitCode = await runDbAction(action, {
          dryRun: options.dryRun,
        });
      });
  }

  db.command('status')
    .description(
      'Show which db manifest is in use and which commands are configured',
    )
    .action(async () => {
      process.exitCode = await dbStatus();
    });
}
