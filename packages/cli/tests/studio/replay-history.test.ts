import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadReplayWithHistory(history: string, writeFileSync = vi.fn()) {
  vi.resetModules();
  const fsMock = {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => history),
    writeFileSync,
  };
  vi.doMock('node:fs', () => ({ default: fsMock, ...fsMock }));
  const replay = await import('../../src/studio/api/replay');
  return { replay, fsMock };
}

describe('Studio replay history loading', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('ignores a persisted value that is not an array', async () => {
    const { replay } = await loadReplayWithHistory('{"legacy":true}');
    expect(replay.requestHistory).toEqual([]);
  });

  it('filters invalid entries and migrates secrets out of persisted history', async () => {
    const { replay, fsMock } = await loadReplayWithHistory(
      JSON.stringify([
        null,
        'invalid',
        {
          id: 'replay-1',
          method: 'POST',
          path: '/users',
          headers: { authorization: 'Bearer secret' },
          query: { token: 'secret' },
          body: { password: 'secret' },
          timestamp: '2026-08-14T00:00:00.000Z',
        },
      ]),
    );

    expect(replay.requestHistory).toHaveLength(1);
    expect(replay.requestHistory[0]).toMatchObject({
      headers: { authorization: '••••••••' },
      query: { token: '••••••••' },
      body: { password: '••••••••' },
    });
    expect(fsMock.writeFileSync).toHaveBeenCalledOnce();
  });

  it('keeps the sanitized in-memory history when migration cannot write', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writeError = new Error('read only');
    const { replay } = await loadReplayWithHistory(
      JSON.stringify([
        {
          id: 'replay-2',
          method: 'GET',
          path: '/',
          headers: { cookie: 'session=secret' },
          query: {},
          body: null,
          timestamp: '2026-08-14T00:00:00.000Z',
        },
      ]),
      vi.fn(() => {
        throw writeError;
      }),
    );

    expect(replay.requestHistory[0].headers.cookie).toBe('••••••••');
    expect(warning).toHaveBeenCalledWith(
      '[Studio] Failed to redact existing replay history:',
      writeError,
    );
  });
});
