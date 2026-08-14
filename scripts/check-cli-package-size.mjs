#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const output = execFileSync(
  'npm',
  ['pack', '--dry-run', '-w', '@axiomify/cli', '--json'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Avoid coupling a read-only package check to the ownership or health
      // of a developer's global npm cache.
      npm_config_cache: join(tmpdir(), 'axiomify-npm-cache'),
    },
  },
);
const [pack] = JSON.parse(output);
const limits = { size: 1_000_000, unpackedSize: 3_000_000 };

for (const [field, limit] of Object.entries(limits)) {
  if (pack[field] > limit) {
    console.error(
      `@axiomify/cli ${field} is ${pack[field]} bytes; limit is ${limit} bytes.`,
    );
    process.exit(1);
  }
}

console.log(
  `CLI package: ${pack.size} bytes compressed, ${pack.unpackedSize} bytes unpacked.`,
);
