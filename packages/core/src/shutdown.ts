import type { Server } from 'http';

export function gracefulShutdown(
  server: Server,
  options?: { timeoutMs?: number; onShutdown?: () => Promise<void> },
): void {
  const timeout = options?.timeoutMs ?? 10_000;
  let draining = false;

  const drain = async () => {
    // Guard against repeated signals (SIGINT spammed, SIGTERM after SIGINT).
    if (draining) return;
    draining = true;

    // Force-exit safety net. Cleared on clean shutdown so we don't exit(1)
    // after a successful exit(0) has already fired.
    const forceExit = setTimeout(() => {
      console.error(
        '[axiomify/core] Graceful shutdown timeout exceeded. Forcing exit.',
      );
      process.exit(1);
    }, timeout);
    forceExit.unref();

    server.close(async (err) => {
      clearTimeout(forceExit);
      if (err) return process.exit(1);
      try {
        if (options?.onShutdown) await options.onShutdown();
        process.exit(0);
      } catch (shutdownErr) {
        console.error('[axiomify/core] onShutdown error:', shutdownErr);
        process.exit(1);
      }
    });
  };

  // `once` so repeated calls to gracefulShutdown don't stack listeners, and
  // so the handler can't fire twice for the same signal.
  process.once('SIGTERM', drain);
  process.once('SIGINT', drain);
}
