import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../src/commands/doctor';
import { DEFAULT_SNAPSHOT_FILE } from '../src/commands/routes';

describe('CLI command entry points', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the documented default route snapshot filename', () => {
    expect(DEFAULT_SNAPSHOT_FILE).toBe('routes-baseline.json');
  });

  it('runs native-runtime diagnostics for the active Node release', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runDoctor();
    expect(process.exit).toHaveBeenCalledTimes(1);
  });
});
