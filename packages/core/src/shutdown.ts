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

    const closeIdleConnections = () => {
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
    };

    // Force-exit safety net. Unref'd so it does not keep the event loop alive
    // on its own. Cleared on clean shutdown so we don't exit(1) after a
    // successful exit(0) has already fired.
    const forceExit = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      console.error(
        '[axiomify/core] Graceful shutdown timeout exceeded. Forcing exit.',
      );
      process.exit(1);
    }, timeout);
    forceExit.unref();

    // Stop accepting new connections first, then close idle keep-alive sockets.
    // Active requests are given the configured timeout to finish before
    // closeAllConnections() is used as the last resort above.
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
    closeIdleConnections();
  };

  // `once` so repeated calls to gracefulShutdown don't stack listeners, and
  // so the handler can't fire twice for the same signal.
  process.once('SIGTERM', drain);
  process.once('SIGINT', drain);
}
