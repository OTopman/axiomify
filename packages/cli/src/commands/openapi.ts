/**
 * `axiomify openapi` — generate the OpenAPI spec from the user's app and
 * emit it to stdout or a file. Useful in CI pipelines where you want to
 * feed the spec into a client-codegen tool (openapi-typescript,
 * openapi-generator, oazapfts, etc) without booting an HTTP listener.
 *
 * Defaults:
 *   - Format: JSON, pretty-printed (2-space indent).
 *   - Output: stdout. Pipe to a file with `> openapi.json` or pass `-o`.
 *
 * The generator is dynamically imported so this command can run even when
 * `@axiomify/openapi` is not installed in the target project — we report
 * a clean error instead of crashing on a missing module.
 */
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import { loadApp } from '../utils/load-app';

export interface OpenApiCmdOptions {
  /** Output file path. When omitted, prints to stdout. */
  output?: string;
  /** Output format. `json` (default) or `yaml`. */
  format?: 'json' | 'yaml';
  /** Minified JSON (single line). Ignored for yaml. */
  minify?: boolean;
  /** Override the spec's `info.title` without editing the source. */
  title?: string;
  /** Override the spec's `info.version` (useful for CI: pipe in $TAG). */
  version?: string;
}

async function jsonToYaml(obj: unknown): Promise<string> {
  // Tiny YAML emitter — handles the subset OpenAPI uses (nested objects,
  // arrays, strings, numbers, booleans, null). Doesn't try to be a full
  // YAML library; if users need real YAML control they can pipe the JSON
  // through `yq` or similar.
  const emit = (v: unknown, indent: number): string => {
    const pad = '  '.repeat(indent);
    if (v === null) return 'null';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    if (typeof v === 'string') {
      // Quote anything with control chars or YAML-special leading bytes.
      if (/[:#\n\r\t"'{}[\]&*!|>%@`]|^\s|\s$/.test(v) || v === '') {
        return JSON.stringify(v);
      }
      return v;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      return v
        .map(
          (item) =>
            `\n${pad}- ${emit(item, indent + 1)
              .replace(/^/gm, '  ')
              .trimStart()}`,
        )
        .join('');
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v as object);
      if (keys.length === 0) return '{}';
      return keys
        .map((k) => {
          const val = (v as Record<string, unknown>)[k];
          const rendered = emit(val, indent + 1);
          if (rendered.startsWith('\n')) return `\n${pad}${k}:${rendered}`;
          return `\n${pad}${k}: ${rendered}`;
        })
        .join('');
    }
    return JSON.stringify(v);
  };
  return emit(obj, 0).trimStart();
}

export async function emitOpenApi(
  entry: string,
  opts: OpenApiCmdOptions = {},
): Promise<void> {
  let app: any;
  let cleanup = async () => {};
  try {
    const loaded = await loadApp(entry);
    app = loaded.app;
    cleanup = loaded.cleanup;
  } catch (err) {
    console.error(pc.red('✗ Failed to load app:'));
    console.error((err as Error).message);
    process.exit(1);
  }

  try {
    // Dynamic import so the CLI doesn't hard-require @axiomify/openapi.
    // Users who don't generate OpenAPI specs shouldn't need the package
    // installed just to be able to invoke the CLI.
    let OpenApiGenerator: any;
    try {
      ({ OpenApiGenerator } = await import('@axiomify/openapi'));
    } catch {
      console.error(
        pc.red('✗ @axiomify/openapi is not installed.'),
        '\n  Install it:',
        pc.cyan('npm install @axiomify/openapi'),
      );
      process.exit(1);
    }

    const info = {
      title: opts.title ?? 'API',
      version: opts.version ?? '1.0.0',
    };
    const generator = new OpenApiGenerator(app, { info });
    const spec = generator.generate();

    // CLI overrides take precedence over whatever's already on the spec.
    if (opts.title) spec.info.title = opts.title;
    if (opts.version) spec.info.version = opts.version;

    const format = opts.format ?? 'json';
    const serialised =
      format === 'yaml'
        ? await jsonToYaml(spec)
        : opts.minify
          ? JSON.stringify(spec)
          : JSON.stringify(spec, null, 2);

    if (opts.output) {
      const outPath = path.resolve(process.cwd(), opts.output);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, serialised + '\n', 'utf8');
      // Status line on stderr so stdout stays clean if someone redirects
      // both. Actually output goes to a file, so we can use stdout here.
      const routeCount = (app.registeredRoutes ?? []).length;
      console.log(
        `${pc.green('✓')} OpenAPI spec written to ${pc.cyan(opts.output)} ` +
          pc.dim(
            `(${routeCount} route${routeCount === 1 ? '' : 's'}, ${format})`,
          ),
      );
    } else {
      process.stdout.write(serialised + '\n');
    }
  } catch (error) {
    console.error(pc.red('✗ Failed to generate spec:'), error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}
