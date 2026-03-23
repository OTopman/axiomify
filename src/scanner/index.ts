import fg from 'fast-glob';
import path from 'path';
import { registry } from '../core/registry';
import { RouteDefinition } from '../core/types';

/**
 * Options for the route scanner.
 */
export interface ScannerOptions {
  /** The absolute path to the directory containing the route files. */
  routesDir: string;
}

/**
 * Scans the provided directory for route definitions and registers them.
 * * @param options Configuration for the scanner.
 * @returns A promise that resolves to the number of routes discovered.
 */
export async function scanAndRegisterRoutes({
  routesDir,
}: ScannerOptions): Promise<number> {
  // 1. Normalize the path to ensure cross-platform compatibility (Windows uses \, Unix uses /)
  // fast-glob requires posix-style paths.
  const normalizedPath = routesDir.split(path.sep).join(path.posix.sep);
  const pattern = path.posix.join(normalizedPath, '**/*.ts');

  // 2. Execute the glob search
  const files = await fg(pattern, { absolute: true });

  let routeCount = 0;

  for (const file of files) {
    try {
      // 3. Dynamically import the module.
      const mod = await import(file);

      // 4. Validate that the file actually exports a valid route configuration
      // FIX: Safely unwrap the export to handle both ESM and CJS interop environments
      const rawExport = mod.default || mod;
      const config = (rawExport.default || rawExport) as RouteDefinition<
        any,
        any,
        any,
        any
      >;

      if (!config || !config.method || !config.path || !config.handler) {
        console.warn(
          `[axiomify] Skipped invalid route file: ${file}. Ensure it uses 'export default route(...)'.`,
        );
        continue;
      }

      // 5. Intelligent Tagging: Extract the parent directory name for OpenAPI tags.
      // Example: 'src/routes/users/get.ts' -> 'users'
      // If it's directly in the routes root, tag it as 'default'.
      const relativeDir = path.dirname(path.relative(routesDir, file));
      const tag =
        relativeDir === '.' || relativeDir === ''
          ? 'default'
          : relativeDir.split(path.sep)[0];

      // 6. Push the validated route into our global singleton registry
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
