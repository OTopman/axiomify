import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../src/index';

describe('useLogger Plugin', () => {
  let stdoutSpy: any;

  beforeEach(() => {
    // Spy on process.stdout.write instead of console.log
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers onRequest, onPostHandler, and onError hooks', () => {
    const mockApp = { addHook: vi.fn() } as any;
    useLogger(mockApp);

    // Verify all three hooks are registered in order
    expect(mockApp.addHook).toHaveBeenCalledTimes(3);
    expect(mockApp.addHook).toHaveBeenNthCalledWith(
      1,
      'onRequest',
      expect.any(Function),
    );
    expect(mockApp.addHook).toHaveBeenNthCalledWith(
      2,
      'onPostHandler',
      expect.any(Function),
    );
    expect(mockApp.addHook).toHaveBeenNthCalledWith(
      3,
      'onError',
      expect.any(Function),
    );
  });

  it('logs incoming requests with masked headers', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useLogger(mockApp, { sensitiveFields: ['authorization'] });

    const onRequestHook = mockApp.addHook.mock.calls[0][1];

    const mockReq = {
      id: 'req_123',
      method: 'POST',
      path: '/api/login',
      ip: '127.0.0.1',
      headers: { authorization: 'Bearer super-secret-token' },
      state: {},
    } as any;

    await onRequestHook(mockReq, {} as any);

    expect(stdoutSpy).toHaveBeenCalled();
    const logOutput = stdoutSpy.mock.calls[0][0];
    const parsedLog = JSON.parse(logOutput); // 🚀 FIX 3: Parse the JSON output

    expect(parsedLog.message).toBe('Incoming Request');
    expect(parsedLog.method).toBe('POST');

    // Verify Maskify successfully redacted the token (visibleStart: 0, visibleEnd: 2)
    expect(parsedLog.headers.authorization).not.toBe(
      'Bearer super-secret-token',
    );

    // The start is fully masked, and the last two chars ('en') are visible
    expect(parsedLog.headers.authorization.startsWith('*')).toBe(true);
    expect(parsedLog.headers.authorization.endsWith('en')).toBe(true);

    // Verify start time was injected
    expect(mockReq.state.startTime).toBeDefined();
  });

  it('logs the response duration in onPostHandler', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useLogger(mockApp);

    const onPostHandlerHook = mockApp.addHook.mock.calls[1][1];

    const mockReq = {
      id: 'req_123',
      method: 'GET',
      path: '/api/users',
      state: { startTime: process.hrtime.bigint() - BigInt(15_000_000) }, // simulate 15ms
    } as any;

    const mockRes = {
      responseMessage: 'Success',
      payload: { ok: true },
    } as any;

    await onPostHandlerHook(mockReq, mockRes);

    expect(stdoutSpy).toHaveBeenCalled();
    const logOutput = stdoutSpy.mock.calls[0][0];
    const parsedLog = JSON.parse(logOutput);

    expect(parsedLog.message).toBe('Outgoing Response');
    expect(parsedLog.method).toBe('GET');
    expect(parsedLog.path).toBe('/api/users');
    expect(parseFloat(parsedLog.durationMs)).toBeGreaterThan(0);
  });

  it('safely handles missing start times on errors', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useLogger(mockApp);
    const onErrorHook = mockApp.addHook.mock.calls[2][1];

    const mockReq = {
      id: 'req_123',
      method: 'DELETE',
      path: '/health',
      state: {},
    } as any;

    await onErrorHook(new Error('Crash'), mockReq);

    const logOutput = stdoutSpy.mock.calls[0][0];
    const parsedLog = JSON.parse(logOutput);

    expect(parsedLog.message).toBe('Request Failed');
    expect(parsedLog.level).toBe('ERROR');
    expect(parsedLog.durationMs).toBe('0.000'); // Fallback duration handles missing startTime smoothly
    expect(parsedLog.error.message).toBe('Crash');
  });
});
