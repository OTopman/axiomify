#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'ui-dist',
]);

function markdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...markdownFiles(join(directory, entry.name)));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(root, join(directory, entry.name)));
    }
  }
  return files;
}

const files = markdownFiles(root).sort();
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
