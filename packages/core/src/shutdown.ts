import type { Server } from 'http';

const shutdownHandlers = new WeakMap<
  Server,
  { sigterm: () => void; sigint: () => void }
>();

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

  const existing = shutdownHandlers.get(server);
  if (existing) {
    process.removeListener('SIGTERM', existing.sigterm);
    process.removeListener('SIGINT', existing.sigint);
  }

  const sigterm = () => void drain();
  const sigint = () => void drain();
  shutdownHandlers.set(server, { sigterm, sigint });
  process.once('SIGTERM', sigterm);
  process.once('SIGINT', sigint);
}
