#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const manifests = execFileSync('rg', [
  '--files',
  'packages',
  '-g',
  'package.json',
])
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);
const failures = [];

for (const file of manifests) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.private) continue;

  for (const section of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (name.startsWith('@axiomify/') && range === '*') {
        failures.push(
          `${file}: ${section}.${name} must use an explicit compatible range`,
        );
      }
    }
  }

  for (const field of [
    'license',
    'repository',
    'files',
    'exports',
    'engines',
  ]) {
    if (!pkg[field]) failures.push(`${file}: missing ${field}`);
  }
  if (pkg.version.split('.')[0] !== root.version.split('.')[0]) {
    failures.push(
      `${file}: major version ${pkg.version} is not aligned with workspace ${root.version}`,
    );
  }
}

if (failures.length) {
  console.error(`Package policy failures:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Validated ${manifests.length} package manifests.`);
