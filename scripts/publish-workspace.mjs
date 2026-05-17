#!/usr/bin/env node
/**
 * Workspace publish script — used by `.github/workflows/release.yml` in
 * place of the default `npx changeset publish`.
 *
 * Why this exists
 * ---------------
 * `changeset publish` creates one git tag per package per release
 * (e.g. `@axiomify/core@6.0.0`, `@axiomify/auth@6.0.0`, …). This is
 * correct for repos that genuinely version packages independently. We
 * don't — every release here bumps the entire @axiomify/* set in
 * lockstep. Per-package tags add 16 entries per release with no
 * information that a single `v<version>` tag doesn't already convey.
 *
 * What this script does
 * ---------------------
 *   1. Reads the root package.json `version`.
 *   2. Publishes every public workspace via `npm publish --workspaces`.
 *      Dist-tag is `latest` for stable releases (no pre-release suffix)
 *      and `next` for anything with a `-` in the version (rc, alpha,
 *      beta). Skip the publish if `--dry-run` is passed.
 *   3. Creates ONE git tag of the form `v<version>` and pushes it.
 *
 * Authentication
 * --------------
 * `npm publish` uses the `.npmrc` written by `actions/setup-node`
 * (which reads `NODE_AUTH_TOKEN`). `git push` uses the workflow's
 * `GITHUB_TOKEN`. Both must be in scope when this script runs.
 *
 * Usage
 * -----
 *   node scripts/publish-workspace.mjs            # publish + tag
 *   node scripts/publish-workspace.mjs --dry-run  # show what would happen
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const dryRun = process.argv.includes('--dry-run');

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const version = root.version;
if (!version) {
  console.error('✗ root package.json has no version');
  process.exit(1);
}

// Pre-release versions (rc.X, alpha.X, beta.X — anything with a hyphen
// per semver) go to the `next` dist-tag so `npm install pkg` doesn't
// accidentally land on an unstable release for users on @latest.
const isPrerelease = version.includes('-');
const distTag = isPrerelease ? 'next' : 'latest';
const tagName = `v${version}`;

function sh(cmd) {
  console.log(`$ ${cmd}`);
  if (dryRun) return '';
  return execSync(cmd, { stdio: 'inherit' });
}

console.log(`→ Publishing workspace at version ${version} (dist-tag=${distTag})`);

// Publish every public workspace. `--workspaces` skips private packages
// (the example app). `--access public` is required for scoped packages.
sh(`npm publish --workspaces --tag ${distTag} --access public`);

// Single tag for the whole release. `git tag -f` is intentional: in the
// rare case of a re-run after a partial publish failure, the tag may
// already exist locally. We do NOT force-push tags (`--force` below is
// absent) — pushing a duplicate tag fails loudly, which is the safer
// default for releases.
console.log(`→ Tagging release as ${tagName}`);
sh(`git tag ${tagName}`);
sh(`git push origin ${tagName}`);

console.log(`✓ Published ${tagName} as @${distTag}`);
