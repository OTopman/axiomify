import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, '../out');
const targetDir = path.resolve(__dirname, '../../cli/ui-dist');

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

// Ensure target directory exists and is clean
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// Copy all static export files to cli/ui-dist
fs.cpSync(sourceDir, targetDir, { recursive: true });
console.log(`Successfully exported Studio UI to ${targetDir}`);
