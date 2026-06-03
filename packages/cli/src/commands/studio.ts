/**
 * `axiomify studio` — launch the Axiomify Studio visual control centre.
 *
 * Loads the user's Axiomify app, runs discovery, and serves the Studio
 * UI on a local HTTP server. Auto-opens the browser by default.
 *
 * Examples:
 *   axiomify studio                    # Uses src/index.ts, port 4399
 *   axiomify studio src/app.ts        # Custom entry file
 *   axiomify studio --port 5000       # Custom port
 *   axiomify studio --no-open         # Don't auto-open browser
 */
import { startStudio } from '../studio';

export interface StudioCommandOptions {
  port?: string;
  open?: boolean;
}

export async function runStudio(
  entry: string,
  options: StudioCommandOptions,
): Promise<void> {
  const port = options.port ? parseInt(options.port, 10) : undefined;

  if (port !== undefined && (isNaN(port) || port < 0 || port > 65535)) {
    console.error('Invalid port number. Must be between 0 and 65535.');
    process.exit(1);
  }

  await startStudio(entry, {
    port,
    open: options.open,
  });
}
