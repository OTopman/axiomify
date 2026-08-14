#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const files = execFileSync('rg', [
  '--files',
  '-g',
  '*.md',
  '-g',
  '!node_modules',
])
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);
const failures = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    const target = rawTarget.split('#', 1)[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      failures.push(`${file}:${line}: invalid URL encoding in ${rawTarget}`);
      continue;
    }
    if (!existsSync(resolve(dirname(file), decoded))) {
      failures.push(`${file}:${line}: missing ${target}`);
    }
  }
}

if (failures.length) {
  console.error(`Broken local documentation links:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Checked local links in ${files.length} Markdown files.`);
