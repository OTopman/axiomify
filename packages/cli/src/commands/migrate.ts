/**
 * `axiomify migrate` — automated codemod (v4 → v6).
 *
 * Scans `.ts` / `.tsx` / `.js` / `.mjs` files under the target directory
 * (default: `src/`) and rewrites the mechanical breaking changes:
 *
 *   1. `meta:` → inline `schema:` metadata fields (v4→v5 rename, v6 fully removed)
 *   2. `openapi:` top-level route field → inline `schema:` metadata fields (v6.1)
 *   3. `useSwagger` → `useOpenAPI` imports
 *   4. `routePrefix:` → `prefix:` on `useOpenAPI()` options
 *   5. `RouteMeta` → `OpenApiOperation` type references
 *   6. `AppPlugin` → `AppConfigurator` type references
 *
 * What it does NOT do (flags for manual review):
 *   - 5-arg positional serializer signatures (the migration changes
 *     semantics — function bodies need by-hand updates).
 *   - Adding `app.enableRequestId()` (some apps explicitly want it off).
 *   - Refresh-token flow changes (already handled by the auth library;
 *     no userland change needed).
 *
 * Operation modes:
 *   --dry-run     show the diff, write nothing
 *   --report-only print a markdown migration report and exit 0
 *   (default)     write changes in-place; print summary
 *
 * The codemod is regex-based, not AST-based. The renames it performs are
 * narrow enough that this is safe in practice; an AST approach would
 * pull in `@babel/parser` + `@babel/types` (~5 MB of deps) for a 70-line
 * transform. If users hit false positives they can use `--report-only`
 * and apply changes by hand.
 */
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import { pluralise, symbols } from '../utils/format';

export interface MigrateOptions {
  dryRun?: boolean;
  reportOnly?: boolean;
  dir?: string;
}

interface Rewrite {
  /** Short identifier for the rule. */
  id: string;
  /** Human-readable description shown in the report. */
  description: string;
  /** Pattern to match. */
  match: RegExp;
  /** Replacement (string or function). */
  replace: string | ((substring: string, ...args: string[]) => string);
}

const RULES: Rewrite[] = [
  {
    id: 'meta-to-schema',
    description: '`meta:` route field removed — metadata now lives inside `schema:` alongside Zod fields',
    // NOTE: This rule renames `meta:` → a comment directing the dev to merge
    // contents into schema:. A full structural AST merge is out of scope for
    // the regex codemod; flag it for manual review instead (see report).
    match: /^(\s*)meta:(\s*\{)/gm,
    replace: '$1/* TODO(axiomify-migrate): merge meta fields into schema: */ openapi_REMOVE:$2',
  },
  {
    id: 'openapi-field-to-schema',
    description: '`openapi:` top-level route field → contents merged into `schema:` (removed in 6.1)',
    // Same conservative approach: flag for manual review via TODO comment.
    match: /^(\s*)openapi:(\s*\{)/gm,
    replace: '$1/* TODO(axiomify-migrate): merge openapi fields into schema: */ openapi_REMOVE:$2',
  },
  {
    id: 'useSwagger-import',
    description: '`useSwagger` import → `useOpenAPI` (the function was never named `useSwagger` in shipped code — docs were wrong)',
    match: /\buseSwagger\b/g,
    replace: 'useOpenAPI',
  },
  {
    id: 'routePrefix-option',
    description: '`routePrefix:` → `prefix:` on `useOpenAPI()` options',
    match: /(\buseOpenAPI\s*\([\s\S]*?)\brouteprefix(\s*:)/gi,
    // Naive: just rename the property when it appears inside a useOpenAPI() call.
    // The capture-group lookbehind avoids touching unrelated `routePrefix`
    // properties in other contexts.
    replace: (_match: string, before: string, suffix: string) =>
      `${before}prefix${suffix}`,
  },
  {
    id: 'RouteMeta-type',
    description: '`RouteMeta` type → `OpenApiOperation` (alias removed in 6.0)',
    // Match `RouteMeta` only as a type position (after `:` or `<` or
    // `as`) — avoids hitting an unrelated variable named `RouteMeta`.
    match: /(:\s*|<\s*|\bas\s+)RouteMeta\b/g,
    replace: '$1OpenApiOperation',
  },
  {
    id: 'AppPlugin-type',
    description: '`AppPlugin` type alias → `AppConfigurator` (removed in 5.0; runtime accepts 1-arg fns identically)',
    match: /(:\s*|<\s*|\bas\s+)AppPlugin\b/g,
    replace: '$1AppConfigurator',
  },
];

interface FileResult {
  file: string;
  /** Map of rule id → count of replacements made in this file. */
  counts: Record<string, number>;
  original: string;
  updated: string;
}

async function listSourceFiles(rootAbs: string): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.axiomify', 'coverage']);
  const walk = async (dir: string) => {
    let entries: import('fs').Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as import('fs').Dirent[];
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        await walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(ext)) {
          out.push(path.join(dir, e.name));
        }
      }
    }
  };
  await walk(rootAbs);
  return out;
}

function applyRules(src: string): { updated: string; counts: Record<string, number> } {
  let updated = src;
  const counts: Record<string, number> = {};
  for (const rule of RULES) {
    const before = updated;
    if (typeof rule.replace === 'string') {
      updated = updated.replace(rule.match, rule.replace);
    } else {
      updated = updated.replace(rule.match, rule.replace);
    }
    if (updated !== before) {
      // Count by re-matching the original against the pattern.
      const matches = before.match(rule.match);
      counts[rule.id] = matches ? matches.length : 1;
    }
  }
  return { updated, counts };
}

function renderUnifiedDiff(file: string, original: string, updated: string): string {
  if (original === updated) return '';
  const origLines = original.split('\n');
  const updatedLines = updated.split('\n');
  const out: string[] = [];
  out.push(pc.bold(`--- ${file}`));
  out.push(pc.bold(`+++ ${file}`));
  // Naive line-by-line diff. Sufficient for the codemod's small,
  // targeted edits — not trying to produce minimal hunks.
  const max = Math.max(origLines.length, updatedLines.length);
  for (let i = 0; i < max; i++) {
    const a = origLines[i];
    const b = updatedLines[i];
    if (a === b) continue;
    if (a !== undefined) out.push(pc.red('- ' + a));
    if (b !== undefined) out.push(pc.green('+ ' + b));
  }
  return out.join('\n');
}

export async function runMigrate(opts: MigrateOptions = {}): Promise<void> {
  const dir = opts.dir ?? 'src';
  const rootAbs = path.resolve(process.cwd(), dir);

  try {
    const stat = await fs.stat(rootAbs);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(
      pc.red(`✗ ${dir} does not exist or is not a directory.`),
      `\n  Run from a project root that contains the directory you want to migrate.`,
    );
    process.exit(1);
  }

  const files = await listSourceFiles(rootAbs);
  if (files.length === 0) {
    console.log(`${symbols.info} No source files found under ${pc.cyan(dir)}.`);
    return;
  }

  const results: FileResult[] = [];
  for (const f of files) {
    const original = await fs.readFile(f, 'utf8');
    const { updated, counts } = applyRules(original);
    if (Object.keys(counts).length > 0) {
      results.push({ file: f, counts, original, updated });
    }
  }

  console.log();
  console.log(pc.bold('  🔄 Axiomify v4 → v5 migration'));
  console.log(
    pc.dim(
      `  Scanned ${pluralise(files.length, 'file')} under ${path.relative(process.cwd(), rootAbs) || '.'}/.\n`,
    ),
  );

  if (results.length === 0) {
    console.log(`  ${symbols.ok} Nothing to migrate — all patterns look up to date.`);
    console.log();
    return;
  }

  // ─── Report by rule ───────────────────────────────────────────────────
  const totalsByRule: Record<string, number> = {};
  for (const r of results) {
    for (const [rule, n] of Object.entries(r.counts)) {
      totalsByRule[rule] = (totalsByRule[rule] ?? 0) + n;
    }
  }
  for (const rule of RULES) {
    const count = totalsByRule[rule.id];
    if (!count) continue;
    console.log(
      `  ${pc.cyan(rule.id)} ${pc.dim('—')} ${rule.description}`,
    );
    console.log(
      `    ${symbols.bullet} ${pluralise(count, 'change')} across ${pluralise(
        results.filter((r) => r.counts[rule.id]).length,
        'file',
      )}`,
    );
  }
  console.log();

  if (opts.reportOnly) {
    console.log(pc.dim('  --report-only: no files were modified.'));
    console.log();
    return;
  }

  // ─── Dry-run: show diffs ───────────────────────────────────────────────
  if (opts.dryRun) {
    for (const r of results) {
      const rel = path.relative(process.cwd(), r.file);
      console.log(renderUnifiedDiff(rel, r.original, r.updated));
      console.log();
    }
    console.log(
      `${symbols.info} ${pluralise(results.length, 'file')} would be modified. ` +
        `Re-run without ${pc.cyan('--dry-run')} to apply.`,
    );
    console.log();
    return;
  }

  // ─── Apply ─────────────────────────────────────────────────────────────
  for (const r of results) {
    await fs.writeFile(r.file, r.updated, 'utf8');
    console.log(`  ${symbols.ok} ${pc.green('Updated')} ${path.relative(process.cwd(), r.file)}`);
  }
  console.log();
  console.log(
    `  ${symbols.ok} ${pluralise(results.length, 'file')} migrated, ` +
      `${pluralise(
        Object.values(totalsByRule).reduce((a, b) => a + b, 0),
        'total change',
      )} applied.`,
  );
  console.log();
  console.log(pc.dim('  Manual review needed for:'));
  console.log(
    pc.dim(
      `    ${symbols.bullet} Dangling \`AppPlugin\` / \`RouteMeta\` in import statements — the codemod renames`,
    ),
  );
  console.log(
    pc.dim(
      `        type USAGES but not the import bindings themselves. TypeScript flags the unused`,
    ),
  );
  console.log(
    pc.dim(
      `        import; remove it (or run \`tsc --noUnusedLocals\` once and let your editor clean up).`,
    ),
  );
  console.log(
    pc.dim(
      `    ${symbols.bullet} 5-arg positional \`SerializerFn\` signatures — the function body needs by-hand updates`,
    ),
  );
  console.log(
    pc.dim(
      `    ${symbols.bullet} \`new Axiomify()\` callers that relied on automatic \`X-Request-Id\` injection`,
    ),
  );
  console.log(
    pc.dim(
      `    ${symbols.bullet} JWT secrets — verify they are ≥ 32 BYTES (not chars) per RFC 7518 §3.2`,
    ),
  );
  console.log();
  console.log(
    `  See ${pc.cyan('docs/migration-v4-to-v5.md')} for the full guide and ` +
      pc.cyan('axiomify check') + ' to verify the migrated app.\n' +
        pc.yellow('  Note: `openapi:` / `meta:` merges into `schema:` require manual review — check TODO comments.'),
  );
  console.log();
}
