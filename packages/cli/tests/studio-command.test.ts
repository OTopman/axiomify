import { afterEach, describe, expect, it, vi } from 'vitest';

const { startStudio } = vi.hoisted(() => ({ startStudio: vi.fn() }));
vi.mock('../src/studio', () => ({ startStudio }));

import { runStudio } from '../src/commands/studio';

describe('studio command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    startStudio.mockReset();
  });

  it('normalizes options before starting Studio', async () => {
    await runStudio('src/app.ts', {
      port: '5000',
      open: false,
      appUrl: 'https://api.example.test',
    });
    expect(startStudio).toHaveBeenCalledWith('src/app.ts', {
      port: 5000,
      open: false,
      appUrl: 'https://api.example.test',
    });
  });

  it.each([
    [{ port: 'invalid' }, 'Invalid port number'],
    [{ port: '70000' }, 'Invalid port number'],
    [{ appUrl: 'file:///tmp/app' }, 'Invalid app URL'],
  ])('rejects invalid options', async (options, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(runStudio('src/index.ts', options)).rejects.toThrow('exit');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(message),
    );
    expect(startStudio).not.toHaveBeenCalled();
  });
});
