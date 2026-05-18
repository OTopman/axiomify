#!/usr/bin/env node

/**
 * Axiomify Codebase Auto-Fix Script
 * Fixes documentation links, badge formats, examples paths, and OpenAPI deprecations
 *
 * Usage: npx tsx scripts/fix-all.ts
 *
 * @author Topman
 * @date 2026-05-18
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';

// ============ CONFIGURATION ============
const ROOT_DIR = resolve(__dirname, '..');
const FILES_TO_SCAN = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'packages/**/*.md',
  'examples/**/*.md',
  'docs/**/*.md',
  'packages/openapi/src/**/*.ts',
  'packages/openapi/README.md',
];

const BADGE_TEMPLATE = `[![npm version](https://img.shields.io/npm/v/@axiomify/{pkg}.svg)](https://npmjs.com/package/@axiomify/{pkg})
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)`;

// ============ FIX FUNCTIONS ============

/**
 * Fix 1: Badge URL formatting - convert plain badges to clickable shield.io links
 */
function fixBadges(
  content: string,
  filePath: string,
): { fixed: boolean; result: string } {
  let fixed = false;
  let result = content;

  // Pattern: ![npm version](https://npmjs.com/package/@axiomify/xxx)
  // Replace with: [![npm version](https://img.shields.io/npm/v/@axiomify/xxx.svg)](https://npmjs.com/package/@axiomify/xxx)
  const badgePatterns = [
    {
      from: /!\[npm version\]\(https:\/\/npmjs\.com\/package\/(@axiomify\/[\w-]+)\)/g,
      to: (match: string, pkg: string) =>
        `[![npm version](https://img.shields.io/npm/v/${pkg}.svg)](https://npmjs.com/package/${pkg})`,
    },
    {
      from: /!\[codecov\]\([^)]+\)/g,
      to: `[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)`,
    },
    {
      from: /!\[OpenSSF Scorecard\]\([^)]+\)/g,
      to: `[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)`,
    },
    {
      from: /!\[License: MIT\]\([^)]+\)/g,
      to: `[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)`,
    },
  ];

  for (const { from, to } of badgePatterns) {
    const newResult = result.replace(
      from,
      typeof to === 'function' ? to : () => to,
    );
    if (newResult !== result) {
      fixed = true;
      result = newResult;
      console.log(`  ✓ Fixed badge format in ${relative(ROOT_DIR, filePath)}`);
    }
  }

  return { fixed, result };
}

/**
 * Fix 2: Documentation links - convert bare paths to proper markdown links
 */
function fixDocLinks(
  content: string,
  filePath: string,
): { fixed: boolean; result: string } {
  let fixed = false;
  let result = content;

  // Pattern: "See docs/packages/core.md for..." → "See [Core API Reference](./docs/packages/core.md) for..."
  const docLinkPatterns = [
    {
      from: /(?:see|See|refer to|Refer to)\s+((?:docs|packages|examples)\/[\w./-]+\.md)/g,
      to: (match: string, path: string) => {
        const name = path
          .split('/')
          .pop()
          ?.replace('.md', '')
          .replace(/-/g, ' ');
        const title = name
          ? `${name.charAt(0).toUpperCase()}${name.slice(1)} Reference`
          : 'Reference';
        return `see [${title}](./${path})`;
      },
    },
    // Pattern: bare relative paths without link syntax: docs/packages/core.md
    {
      from: /(?<!\[|\()\b((?:\.\/)?(?:docs|packages|examples)\/[\w./-]+\.md)(?!\))/g,
      to: (match: string, path: string) => {
        const cleanPath = path.startsWith('./') ? path : `./${path}`;
        return `[${cleanPath}](${cleanPath})`;
      },
    },
  ];

  for (const { from, to } of docLinkPatterns) {
    const newResult = result.replace(
      from,
      typeof to === 'function' ? to : () => to,
    );
    if (newResult !== result) {
      fixed = true;
      result = newResult;
      console.log(
        `  ✓ Fixed documentation links in ${relative(ROOT_DIR, filePath)}`,
      );
    }
  }

  return { fixed, result };
}

/**
 * Fix 3: Replace /samples references with /examples
 */
function fixSamplesPath(
  content: string,
  filePath: string,
): { fixed: boolean; result: string } {
  let fixed = false;
  let result = content;

  // Replace /samples or samples/ with /examples or examples/
  const samplesRegex = /\/samples\b|samples\//g;
  if (samplesRegex.test(result)) {
    result = result.replace(samplesRegex, (match) => {
      fixed = true;
      return match.replace('samples', 'examples');
    });
    if (fixed) {
      console.log(
        `  ✓ Replaced /samples → /examples in ${relative(ROOT_DIR, filePath)}`,
      );
    }
  }

  return { fixed, result };
}

/**
 * Fix 4: OpenAPI deprecations - routePrefix → prefix, fix 404 example
 */
function fixOpenAPI(
  content: string,
  filePath: string,
): { fixed: boolean; result: string } {
  let fixed = false;
  let result = content;

  // Only process OpenAPI-related files
  if (!filePath.includes('openapi')) return { fixed, result };

  // Fix 4a: routePrefix → prefix
  if (/routePrefix\s*:/.test(result)) {
    result = result.replace(/routePrefix\s*:/g, 'prefix:');
    fixed = true;
    console.log(
      `  ✓ Replaced routePrefix → prefix in ${relative(ROOT_DIR, filePath)}`,
    );
  }

  // Fix 4b: 404 response example - null → { message: 'Not Found' }
  if (/\.status\(404\)\.send\(null/.test(result)) {
    result = result.replace(
      /\.status\(404\)\.send\(null,\s*['"]Not Found['"]\)/g,
      `.status(404).send({ message: 'Not Found' })`,
    );
    fixed = true;
    console.log(
      `  ✓ Fixed 404 response example in ${relative(ROOT_DIR, filePath)}`,
    );
  }

  // Fix 4c: Add deprecation note comment if not present
  if (
    filePath.endsWith('README.md') &&
    /prefix:\s*['"]\/docs['"]/.test(result) &&
    !/v6\.0/.test(result)
  ) {
    result = result.replace(
      /(prefix:\s*['"]\/docs['"])/,
      `$1 // ✅ Use \`prefix\` (v6.0+); \`routePrefix\` was removed in 6.0`,
    );
    fixed = true;
    console.log(
      `  ✓ Added deprecation note for prefix option in ${relative(
        ROOT_DIR,
        filePath,
      )}`,
    );
  }

  return { fixed, result };
}

/**
 * Fix 5: Add badge template to CONTRIBUTING.md if missing
 */
function fixContributingBadges(
  content: string,
  filePath: string,
): { fixed: boolean; result: string } {
  if (!filePath.endsWith('CONTRIBUTING.md'))
    return { fixed: false, result: content };

  if (content.includes('npm version') && content.includes('shield.io')) {
    return { fixed: false, result: content }; // Already has badges
  }

  // Insert badges after the first heading
  const lines = content.split('\n');
  const insertIndex = lines.findIndex((line) => line.startsWith('# ')) + 1;

  if (insertIndex > 0) {
    const pkgName = '@axiomify/core'; // Default, can be parameterized
    const badges = BADGE_TEMPLATE.replace(/{pkg}/g, pkgName) + '\n';
    lines.splice(insertIndex, 0, '', badges, '');

    console.log(`  ✓ Added badge template to CONTRIBUTING.md`);
    return { fixed: true, result: lines.join('\n') };
  }

  return { fixed: false, result: content };
}

/**
 * Fix 6: Ensure package READMEs have consistent badge header
 */
function fixPackageReadmeBadges(
  content: string,
  filePath: string,
): { fixed: boolean; result: string } {
  if (!filePath.includes('packages/') || !filePath.endsWith('README.md')) {
    return { fixed: false, result: content };
  }

  // Extract package name from path: packages/core/README.md → @axiomify/core
  const pkgMatch = filePath.match(/packages\/([\w-]+)\/README\.md$/);
  if (!pkgMatch) return { fixed: false, result: content };

  const pkgName = `@axiomify/${pkgMatch[1]}`;
  const expectedBadges = BADGE_TEMPLATE.replace(/{pkg}/g, pkgName);

  // Check if badges already exist (case-insensitive, whitespace-tolerant)
  const hasBadges =
    content.toLowerCase().includes('npm version') &&
    content.includes('shield.io') &&
    content.includes(pkgName);

  if (hasBadges) return { fixed: false, result: content };

  // Insert badges after the first heading
  const lines = content.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim().startsWith('# '));

  if (headingIndex >= 0) {
    // Skip existing blank lines after heading
    let insertAt = headingIndex + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') {
      insertAt++;
    }

    lines.splice(insertAt, 0, '', expectedBadges, '');
    console.log(`  ✓ Added consistent badges to ${pkgName} README`);
    return { fixed: true, result: lines.join('\n') };
  }

  return { fixed: false, result: content };
}

// ============ MAIN EXECUTION ============

function globFiles(patterns: string[], root: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and .git
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist')
          continue;
        walk(fullPath);
      } else if (stat.isFile()) {
        const relPath = relative(root, fullPath);
        // Simple glob matching
        if (
          patterns.some((pattern) => {
            if (pattern.includes('**')) {
              const regex = new RegExp(
                '^' +
                  pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') +
                  '$',
              );
              return regex.test(relPath);
            }
            return relPath === pattern;
          })
        ) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(root);
  return results;
}

function main() {
  console.log('🔧 Axiomify Auto-Fix Script v1.0');
  console.log('================================\n');

  const files = globFiles(FILES_TO_SCAN, ROOT_DIR);
  console.log(`📁 Found ${files.length} files to process\n`);

  let totalFixed = 0;
  let totalFiles = 0;

  for (const filePath of files) {
    try {
      const original = readFileSync(filePath, 'utf-8');
      let content = original;
      let fileFixed = false;

      // Apply all fixes
      const fixes = [
        fixBadges,
        fixDocLinks,
        fixSamplesPath,
        fixOpenAPI,
        fixContributingBadges,
        fixPackageReadmeBadges,
      ];

      for (const fix of fixes) {
        const { fixed, result } = fix(content, filePath);
        if (fixed) {
          content = result;
          fileFixed = true;
        }
      }

      // Write back if changed
      if (fileFixed && content !== original) {
        // Create backup
        const backupPath = `${filePath}.bak.${Date.now()}`;
        writeFileSync(backupPath, original, 'utf-8');
        console.log(`  📦 Backup: ${relative(ROOT_DIR, backupPath)}`);

        writeFileSync(filePath, content, 'utf-8');
        totalFixed++;
        console.log(`  ✅ Fixed: ${relative(ROOT_DIR, filePath)}\n`);
      }

      totalFiles++;

      // Progress indicator
      if (totalFiles % 10 === 0) {
        console.log(`⏳ Processed ${totalFiles}/${files.length} files...\n`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${filePath}:`, error);
    }
  }

  console.log('\n================================');
  console.log(`📊 Summary:`);
  console.log(`   Files scanned: ${totalFiles}`);
  console.log(`   Files fixed:   ${totalFixed}`);
  console.log(`   Backups saved: ${totalFixed} (*.bak.TIMESTAMP)`);
  console.log('\n✨ All fixes applied successfully!');
  console.log('\n🔍 Next steps:');
  console.log('   1. Review changes: git diff');
  console.log('   2. Test locally: npm run build && npm test');
  console.log(
    '   3. Commit: git add -A && git commit -m "docs: auto-fix documentation issues"',
  );
  console.log('   4. Clean backups: find . -name "*.bak.*" -delete');
}

// Run if executed directly
if (require.main === module) {
  main();
}

export {
  fixBadges,
  fixContributingBadges,
  fixDocLinks,
  fixOpenAPI,
  fixPackageReadmeBadges,
  fixSamplesPath,
};
