import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../src/commands/doctor';
import { DEFAULT_SNAPSHOT_FILE, inspectRoutes } from '../src/commands/routes';

vi.mock('../src/utils/load-app', () => ({
  loadApp: vi.fn(async () => ({
    app: { registeredRoutes: [], registeredWsRoutes: [] },
    cleanup: vi.fn(),
  })),
}));

describe('CLI command entry points', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the documented default route snapshot filename', () => {
    expect(DEFAULT_SNAPSHOT_FILE).toBe('routes-baseline.json');
  });

  it('reports an unreadable route baseline and marks the command failed', async () => {
    const previousExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;

    try {
      await inspectRoutes('mock-app', {
        diff: '/definitely-missing/axiomify-routes-baseline.json',
      });

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load baseline'),
        expect.any(String),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('runs native-runtime diagnostics for the active Node release', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runDoctor();
    const nodeMajor = Number.parseInt(process.versions.node, 10);
    const supported = nodeMajor === 22 || nodeMajor === 24;
    expect(process.exit).toHaveBeenCalledTimes(supported ? 0 : 1);
  });
});
