import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getToken, removeToken, setToken } from '../src/utils/api';

const storage = new Map<string, string>();

describe('Studio API client', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores and removes the Studio access token', () => {
    expect(getToken()).toBe('');
    setToken('studio-token');
    expect(getToken()).toBe('studio-token');
    removeToken();
    expect(getToken()).toBe('');
  });

  it('adds the Studio bearer token without discarding supplied headers', async () => {
    setToken('studio-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/__studio/api/system', {
      headers: { 'X-Request-Source': 'test' },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0];
    expect(new Headers(options.headers).get('authorization')).toBe(
      'Bearer studio-token',
    );
    expect(new Headers(options.headers).get('x-request-source')).toBe('test');
  });
});
