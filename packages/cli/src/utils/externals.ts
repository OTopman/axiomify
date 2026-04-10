import fs from 'fs';
import path from 'path';

export function getUserExternals(cwd: string): string[] {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      return [...deps, ...devDeps];
    }
  } catch (err) {
    console.warn(
      '[Axiomify CLI] Failed to read package.json, defaulting to empty externals.',
    );
  }
  return [];
}
