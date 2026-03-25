import fg from 'fast-glob';
import path from 'path';
import { createJiti } from 'jiti';
import { registry } from '../core/registry';
import { RouteDefinition } from '../core/types';

export interface ScannerOptions {
  routesDir: string;
}

export async function scanAndRegisterRoutes({
  routesDir,
}: ScannerOptions): Promise<number> {
  const normalizedPath = routesDir.split(path.sep).join(path.posix.sep);
  const pattern = path.posix.join(normalizedPath, '**/*.{ts,js,mjs,cjs}');

  const files = await fg(pattern, { absolute: true });

  // Since we pass absolute paths to jiti later, the exact init file doesn't matter.
  const jiti = createJiti(path.join(process.cwd(), 'index.js'));

  let routeCount = 0;

  for (const file of files) {
    try {
      const mod = await jiti.import(file, { default: true });

      const rawExport = (mod || {}) as Record<string, unknown>;
      const config = (rawExport.default || rawExport) as RouteDefinition;

      if (!config || !config.method || !config.path || !config.handler) {
        console.warn(
          `[axiomify] Skipped invalid route file: ${file}. Ensure it uses 'export default route(...)'.`,
        );
        continue;
      }

      const relativeDir = path.dirname(path.relative(routesDir, file));
      const tag =
        relativeDir === '.' || relativeDir === ''
          ? 'default'
          : relativeDir.split(path.sep)[0];

      registry.register({
        filePath: file,
        tag,
        config,
      });

      routeCount++;
    } catch (error) {
      console.error(`[axiomify] Failed to load route from ${file}:`, error);
    }
  }

  return routeCount;
}
