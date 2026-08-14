#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const manifests = readdirSync('packages', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join('packages', entry.name, 'package.json'))
  .filter((file) => {
    try {
      readFileSync(file);
      return true;
    } catch {
      return false;
    }
  })
  .sort();
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
