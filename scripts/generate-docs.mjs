#!/usr/bin/env node
/**
 * generate-docs.mjs
 *
 * Reads every @axiomify/* package's TypeScript source files, sends them to the
 * Claude API, and writes production-quality markdown documentation into
 * docs/packages/<name>.md — matching the format of the existing hand-written docs.
 *
 * Usage
 * ─────
 *   # Generate docs for all packages
 *   node scripts/generate-docs.mjs
 *
 *   # One package only
 *   node scripts/generate-docs.mjs --package rate-limit
 *
 *   # Preview the prompt without calling the API
 *   node scripts/generate-docs.mjs --package auth --dry-run
 *
 *   # Overwrite even if the file already exists
 *   node scripts/generate-docs.mjs --package ws --force
 *
 * Requirements
 * ────────────
 *   ANTHROPIC_API_KEY environment variable must be set.
 *   Node.js >= 18 (uses built-in fetch).
 *   Run from the repo root: node scripts/generate-docs.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const ROOT         = resolve('.');
const PACKAGES_DIR = join(ROOT, 'packages');
const OUTPUT_DIR   = join(ROOT, 'docs', 'packages');
const MODEL        = 'claude-sonnet-4-20250514';
const MAX_TOKENS   = 4096;

// How much source to send per package before we warn (not a hard limit — the
// API handles large contexts fine, but very large packages may exceed a single
// request's output quality). Roughly 60k chars ≈ 15k tokens of source code.
const SOURCE_CHAR_WARN = 60_000;

// Delay between API calls so we don't hit rate limits when generating all packages.
const DELAY_MS = 1_500;

// ── CLI args ────────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const pkgFlag      = args.indexOf('--package');
const targetPkg    = pkgFlag !== -1 ? args[pkgFlag + 1] : null;
const dryRun       = args.includes('--dry-run');
const force        = args.includes('--force');
const showHelp     = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
Usage: node scripts/generate-docs.mjs [options]

Options:
  --package <name>   Generate docs for one package only (e.g. --package auth)
  --dry-run          Print the prompt without calling the API
  --force            Overwrite existing docs files
  --help             Show this help message

Environment:
  ANTHROPIC_API_KEY  Required — your Anthropic API key
`);
  process.exit(0);
}

// ── Validate environment ─────────────────────────────────────────────────────

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY && !dryRun) {
  console.error('✗  ANTHROPIC_API_KEY is not set. Export it and try again.');
  console.error('   export ANTHROPIC_API_KEY="sk-ant-..."');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Recursively collect all .ts files under a directory,
 * excluding test files and type declaration files.
 */
function collectSourceFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Read a JSON file and return parsed object, or null on failure.
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Discover all packages in the monorepo.
 * Returns an array of { name, slug, dir, pkgJson } objects.
 */
function discoverPackages() {
  const packages = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const pkgJson = readJson(join(dir, 'package.json'));
    if (!pkgJson?.name) continue;
    packages.push({
      name: pkgJson.name,           // e.g. @axiomify/auth
      slug: entry,                  // e.g. auth
      dir,
      pkgJson,
    });
  }
  return packages.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Build the full source context string for a package.
 * Includes file paths as headers so Claude knows the module structure.
 */
function buildSourceContext(pkg) {
  const srcDir  = join(pkg.dir, 'src');
  const files   = collectSourceFiles(srcDir);
  const parts   = [];

  for (const file of files) {
    const relPath = relative(ROOT, file);
    const content = readFileSync(file, 'utf8');
    parts.push(`// ── ${relPath} ──\n${content}`);
  }

  return parts.join('\n\n');
}

/**
 * Read the existing doc file for this package if it exists.
 * Used to give Claude the current format as a style reference.
 */
function existingDoc(slug) {
  const path = join(OUTPUT_DIR, `${slug}.md`);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Build a rich system prompt that frames Axiomify and the documentation
 * conventions Claude should follow.
 */
function buildSystemPrompt() {
  return `\
You are a senior technical writer for Axiomify, a Node.js framework built around:

- A Zod-first schema layer (one schema → validation + TypeScript types + OpenAPI)
- An adapter architecture: @axiomify/core is transport-agnostic; adapters (@axiomify/http,
  @axiomify/native/uWS, @axiomify/fastify, @axiomify/express, @axiomify/hapi) plug in
- A monorepo of focused plugin packages: auth, cors, helmet, logger, metrics, rate-limit,
  security, ws, openapi, graphql, upload, static, fingerprint, cli

Your job is to write the markdown documentation page for a single package.

DOCUMENTATION STYLE RULES — follow these exactly:

1. Format: CommonMark markdown. No HTML tags. No frontmatter.

2. Structure every page with exactly these sections in this order:
   # @axiomify/<name>
   One-sentence description on the very next line (no blank line between heading and description).

   ## Install
   npm install command(s). Include peer deps.

   ## Quick start
   Minimal but complete working TypeScript example (≤30 lines). Real code, not pseudocode.
   Show the most common use case. Import from the correct package name.

   ## API
   Table or structured list of every exported function, class, and type. Columns: Export | Description.
   For classes, show the constructor signature then list methods.

   ## Configuration
   If the package exports an options interface, document every option as a table:
   | Option | Type | Default | Description |
   Show real defaults extracted from the source code — never write "see source".

   ## Usage patterns
   2–4 concrete TypeScript code blocks covering real scenarios beyond the quick start.
   Title each with a ### heading that names the scenario (e.g. ### Token revocation with Redis).
   Each example must be self-contained and runnable.

   ## Caveats
   Honest, specific notes about known limitations, edge cases, and things that will
   surprise developers. Extract these from comments marked ⚠️ or "NOTE:" in the source.
   If there are none, omit this section.

3. Code blocks: always use \`\`\`typescript (not \`\`\`ts or \`\`\`js).
   Exception: shell commands use \`\`\`bash.

4. Never invent APIs. Only document what is in the source code.

5. Never write "TODO", "coming soon", or "see the source for details".

6. Keep descriptions precise and short. No marketing language.
   Bad: "This powerful plugin supercharges your authentication workflow."
   Good: "Route middleware that validates Bearer JWT tokens and writes the decoded payload to req.state.authUser."

7. Cross-reference other @axiomify packages when the integration is real and documented
   in the source (e.g. @axiomify/metrics can receive wsManager from @axiomify/ws).

8. Deprecated exports: mark with a "> **Deprecated in v6.** Use X instead." blockquote.`;
}

/**
 * Build the per-package user prompt.
 */
function buildUserPrompt(pkg, sourceContext) {
  const { name, slug, pkgJson } = pkg;
  const deps        = Object.keys(pkgJson.dependencies ?? {}).join(', ') || 'none';
  const peers       = Object.keys(pkgJson.peerDependencies ?? {}).join(', ') || 'none';
  const optDeps     = Object.keys(pkgJson.optionalDependencies ?? {}).join(', ') || 'none';
  const existing    = existingDoc(slug);

  const styleRef = existing
    ? `\nHere is the existing doc file for this package. Use its structure and voice as a reference, but rewrite it from scratch using the source code — do not copy the existing text verbatim:\n\n<existing_doc>\n${existing.slice(0, 3000)}\n</existing_doc>\n`
    : '';

  return `\
Write the complete documentation page for the \`${name}\` package.

Package metadata:
- Name: ${name}
- Version: ${pkgJson.version ?? 'unknown'}
- Runtime dependencies: ${deps}
- Peer dependencies: ${peers}
- Optional dependencies: ${optDeps}
${styleRef}
Here is the full TypeScript source code for this package. Read it carefully before writing anything:

<source>
${sourceContext}
</source>

Write the complete markdown documentation page now. Start directly with the # heading — no preamble.`;
}

/**
 * Call the Claude API and return the generated text.
 */
async function callClaude(systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }

  const data = await response.json();

  if (data.stop_reason === 'max_tokens') {
    console.warn('  ⚠  Response hit max_tokens — the doc may be truncated. Consider splitting this package.');
  }

  return data.content?.[0]?.text ?? '';
}

/**
 * Generate and write documentation for a single package.
 */
async function generatePackageDoc(pkg, systemPrompt, index, total) {
  const { name, slug } = pkg;
  const outputPath = join(OUTPUT_DIR, `${slug}.md`);
  const label = `[${index}/${total}] ${name}`;

  // Skip if already exists and --force not set
  if (existsSync(outputPath) && !force) {
    console.log(`  ${label} — skipping (file exists, use --force to overwrite)`);
    return;
  }

  console.log(`\n${label}`);

  // Collect source
  const sourceContext = buildSourceContext(pkg);
  const sourceLen     = sourceContext.length;
  console.log(`  Source: ${sourceLen.toLocaleString()} chars across ${pkg.dir}/src`);

  if (sourceLen === 0) {
    console.log('  ✗ No source files found — skipping.');
    return;
  }

  if (sourceLen > SOURCE_CHAR_WARN) {
    console.log(`  ⚠  Large source (>${(SOURCE_CHAR_WARN / 1000).toFixed(0)}k chars) — response quality may vary.`);
  }

  // Build prompts
  const userPrompt = buildUserPrompt(pkg, sourceContext);

  if (dryRun) {
    console.log('\n── SYSTEM PROMPT (first 500 chars) ──────────────────────────────');
    console.log(systemPrompt.slice(0, 500) + '...');
    console.log('\n── USER PROMPT (first 800 chars) ────────────────────────────────');
    console.log(userPrompt.slice(0, 800) + '...');
    console.log('─────────────────────────────────────────────────────────────────\n');
    return;
  }

  // Call API
  console.log(`  Calling Claude API (${MODEL})...`);
  const startMs = Date.now();
  const markdown = await callClaude(systemPrompt, userPrompt);
  const elapsed  = ((Date.now() - startMs) / 1000).toFixed(1);

  if (!markdown.trim()) {
    console.log('  ✗ Empty response — skipping write.');
    return;
  }

  // Write output
  writeFileSync(outputPath, markdown.trimEnd() + '\n', 'utf8');
  console.log(`  ✓ Written to docs/packages/${slug}.md (${markdown.length.toLocaleString()} chars, ${elapsed}s)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Axiomify doc generator');
  console.log(`Model:  ${MODEL}`);
  console.log(`Output: ${relative(ROOT, OUTPUT_DIR)}/`);
  if (dryRun)  console.log('Mode:   DRY RUN — no API calls, no files written');
  if (force)   console.log('Mode:   FORCE — overwriting existing files');
  console.log('');

  // Discover packages
  let packages = discoverPackages();

  if (targetPkg) {
    packages = packages.filter(p => p.slug === targetPkg || p.name === targetPkg);
    if (packages.length === 0) {
      console.error(`✗ Package "${targetPkg}" not found in ${PACKAGES_DIR}`);
      console.error(`  Available: ${discoverPackages().map(p => p.slug).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Packages to process: ${packages.map(p => p.slug).join(', ')}\n`);

  // Build system prompt once (same for all packages)
  const systemPrompt = buildSystemPrompt();

  // Process each package
  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    try {
      await generatePackageDoc(pkg, systemPrompt, i + 1, packages.length);
      succeeded++;
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      failed++;
    }

    // Pause between requests to avoid rate limiting (skip on last item or dry-run)
    if (!dryRun && i < packages.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Summary
  console.log('\n──────────────────────────────────────');
  if (dryRun) {
    console.log(`Dry run complete. ${packages.length} package(s) inspected.`);
  } else {
    console.log(`Done. ${succeeded} succeeded, ${failed} failed.`);
    if (failed > 0) {
      console.log('Re-run failed packages individually with --package <name> --force');
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
