import type { Server } from 'http';

export function gracefulShutdown(
  server: Server,
  options?: { timeoutMs?: number; onShutdown?: () => Promise<void> },
): void {
  const timeout = options?.timeoutMs ?? 10_000;

  const drain = async () => {
    server.close(async (err) => {
      if (err) process.exit(1);
      if (options?.onShutdown) await options.onShutdown();
      process.exit(0);
    });

    setTimeout(() => {
      console.error(
        '[axiomify/core] Graceful shutdown timeout exceeded. Forcing exit.',
      );
      process.exit(1);
    }, timeout).unref();
  };

  process.on('SIGTERM', drain);
  process.on('SIGINT', drain);
}
