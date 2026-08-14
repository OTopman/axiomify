/**
 * CLI manifest contract (schema v1) — STABLE.
 *
 * The Axiomify CLI's `db` commands discover a project's database workflow
 * through a manifest file at the project root:
 *
 *  - `axiomify.db.json` — plain JSON; commands must be shell strings.
 *  - `axiomify.db.mjs`  — ES module (dynamic import); commands may also be
 *    functions, and the config should be the default export (ideally wrapped
 *    in `defineDbConfig()` for editor typing).
 *
 * Schema v1:
 * ```jsonc
 * {
 *   "version": 1,
 *   "commands": {
 *     "migrate":  "prisma migrate deploy",   // string | function (mjs only)
 *     "seed":     "node ./scripts/seed.mjs",
 *     "generate": "prisma generate"
 *   }
 * }
 * ```
 * `commands` and each command are optional. Unknown top-level keys are
 * ignored (forward compatibility); unknown command names are rejected.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

/** A db command: a shell string, or (in `.mjs` manifests) a function. */
export type DbCommand = string | ((...args: unknown[]) => unknown);

/** The v1 manifest shape. */
export interface DbConfig {
  version: 1;
  commands?: {
    migrate?: DbCommand;
    seed?: DbCommand;
    generate?: DbCommand;
  };
}

/** What {@link loadDbConfig} resolves with when a manifest is found. */
export interface LoadedDbConfig {
  /** Absolute path of the manifest file that was loaded. */
  path: string;
  /** Which flavor was loaded. */
  format: 'json' | 'mjs';
  /** The validated config. */
  config: DbConfig;
}

export const DB_CONFIG_FILES = ['axiomify.db.json', 'axiomify.db.mjs'] as const;

const COMMAND_NAMES = ['migrate', 'seed', 'generate'] as const;

/**
 * Typed identity helper for `axiomify.db.mjs` manifests — gives you editor
 * completion and validates the shape eagerly so mistakes surface where the
 * config is written, not when the CLI loads it.
 *
 * ```js
 * // axiomify.db.mjs
 * import { defineDbConfig } from '@axiomify/db';
 * export default defineDbConfig({
 *   version: 1,
 *   commands: { migrate: 'prisma migrate deploy' },
 * });
 * ```
 */
export function defineDbConfig(config: DbConfig): DbConfig {
  validateDbConfig(config, 'defineDbConfig()', true);
  return config;
}

function fail(source: string, problem: string): never {
  throw new Error(`[@axiomify/db] Invalid db config (${source}): ${problem}`);
}

function validateDbConfig(
  value: unknown,
  source: string,
  allowFunctions: boolean,
): asserts value is DbConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(source, `expected an object, got ${describe(value)}.`);
  }
  const config = value as Record<string, unknown>;

  if (config.version === undefined) {
    fail(source, 'missing required "version" field. Set `"version": 1`.');
  }
  if (config.version !== 1) {
    fail(
      source,
      `unsupported version ${JSON.stringify(config.version)}. ` +
        'This release of @axiomify/db supports schema version 1.',
    );
  }

  if (config.commands === undefined) return;
  const commands = config.commands;
  if (
    commands === null ||
    typeof commands !== 'object' ||
    Array.isArray(commands)
  ) {
    fail(source, `"commands" must be an object, got ${describe(commands)}.`);
  }

  for (const [name, command] of Object.entries(commands)) {
    if (!(COMMAND_NAMES as readonly string[]).includes(name)) {
      fail(
        source,
        `unknown command "${name}". Allowed commands: ${COMMAND_NAMES.join(', ')}.`,
      );
    }
    if (command === undefined) continue;
    if (typeof command === 'string') {
      if (command.trim() === '') {
        fail(source, `command "${name}" must not be an empty string.`);
      }
      continue;
    }
    if (typeof command === 'function') {
      if (!allowFunctions) {
        fail(
          source,
          `command "${name}" is a function, which JSON cannot express. ` +
            'Use an axiomify.db.mjs manifest for function commands.',
        );
      }
      continue;
    }
    fail(
      source,
      `command "${name}" must be a string${allowFunctions ? ' or function' : ''}, ` +
        `got ${describe(command)}.`,
    );
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `type "${typeof value}"`;
}

/**
 * Load an `.mjs` manifest module.
 *
 * The `@vite-ignore` comment keeps vite/vitest from trying to resolve the
 * dynamic specifier at transform time; native ESM loaders ignore it. In the
 * CJS build esbuild rewrites `import()` to `require()`, which rejects
 * `file://` URLs — the `createRequire` fallback covers that build on Node
 * versions with `require(esm)` support (20.19+ / 22.12+). The `?t=` query
 * cache-busts the ESM path so repeated loads see manifest edits; the
 * require fallback cannot cache-bust (documented CJS limitation).
 */
let _manifestLoadSeq = 0;

async function importManifest(
  mjsPath: string,
): Promise<Record<string, unknown>> {
  // Monotonic counter, not Date.now(): two loads in the same millisecond
  // (common in tests) must still get distinct specifiers.
  const href = `${pathToFileURL(mjsPath).href}?t=${++_manifestLoadSeq}`;
  try {
    return await import(/* @vite-ignore */ href);
  } catch (err) {
    try {
      const { createRequire } = await import('node:module');
      return createRequire(mjsPath)(mjsPath) as Record<string, unknown>;
    } catch {
      throw err;
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate, load and validate the db manifest for a project.
 *
 * Looks for `axiomify.db.json`, then `axiomify.db.mjs`, directly inside
 * `cwd` (no upward traversal). Resolves `null` when neither exists — the
 * caller (typically the CLI) decides whether that is an error. Throws with
 * a clear message when:
 *
 *  - both manifest files exist (ambiguous — remove one),
 *  - the JSON is malformed or the module fails to import,
 *  - the config does not match schema v1.
 */
export async function loadDbConfig(
  cwd: string,
): Promise<LoadedDbConfig | null> {
  if (typeof cwd !== 'string' || cwd === '') {
    throw new TypeError(
      '[@axiomify/db] loadDbConfig requires a directory path.',
    );
  }
  const jsonPath = path.resolve(cwd, DB_CONFIG_FILES[0]);
  const mjsPath = path.resolve(cwd, DB_CONFIG_FILES[1]);
  const [hasJson, hasMjs] = await Promise.all([
    exists(jsonPath),
    exists(mjsPath),
  ]);

  if (hasJson && hasMjs) {
    throw new Error(
      `[@axiomify/db] Found both ${DB_CONFIG_FILES[0]} and ${DB_CONFIG_FILES[1]} ` +
        `in ${cwd}. Keep exactly one manifest and delete the other.`,
    );
  }
  if (!hasJson && !hasMjs) return null;

  if (hasJson) {
    const raw = await fs.readFile(jsonPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[@axiomify/db] Failed to parse ${jsonPath}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    validateDbConfig(parsed, jsonPath, false);
    return { path: jsonPath, format: 'json', config: parsed };
  }

  let mod: Record<string, unknown>;
  try {
    mod = await importManifest(mjsPath);
  } catch (err) {
    throw new Error(
      `[@axiomify/db] Failed to import ${mjsPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const config = mod.default ?? mod.config;
  if (config === undefined) {
    throw new Error(
      `[@axiomify/db] ${mjsPath} has no default export. ` +
        'Export the config as `export default defineDbConfig({ ... })`.',
    );
  }
  validateDbConfig(config, mjsPath, true);
  return { path: mjsPath, format: 'mjs', config };
}
