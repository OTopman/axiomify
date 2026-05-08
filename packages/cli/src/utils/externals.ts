import fs from 'fs';
import path from 'path';

// Known native dependencies that must never be bundled by esbuild
const ALWAYS_EXTERNAL = ['uWebSockets.js'];

export function getUserExternals(cwd: string): string[] {
  let pkgExternals: string[] = [];

  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      pkgExternals = [...deps, ...devDeps];
    }
  } catch (err) {
    // Include the actual error so users can debug malformed package.json
    // instead of seeing a generic "defaulting to empty" message.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Axiomify CLI] Failed to read package.json (${message}); ` +
        'defaulting to empty externals.',
    );
  }

  // Merge the dynamic package.json externals with our hardcoded native ones
  return Array.from(new Set([...ALWAYS_EXTERNAL, ...pkgExternals]));
}
