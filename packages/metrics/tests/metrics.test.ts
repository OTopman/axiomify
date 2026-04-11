import { describe, expect, it, vi } from 'vitest';
import { useMetrics } from '../src/index';

describe('useMetrics Plugin', () => {
  it('registers the onPostHandler hook and the /metrics route', () => {
    const mockApp = { addHook: vi.fn(), route: vi.fn() } as any;
    useMetrics(mockApp);

    expect(mockApp.addHook).toHaveBeenCalledWith(
      'onPostHandler',
      expect.any(Function),
    );
    expect(mockApp.route).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/metrics' }),
    );
  });

  it('records metrics and outputs prometheus format', async () => {
    const mockApp = { addHook: vi.fn(), route: vi.fn() } as any;
    useMetrics(mockApp);

    const hookFn = mockApp.addHook.mock.calls[0][1];
    const routeFn = mockApp.route.mock.calls[0][0].handler;

    // Simulate a request
    const mockReq = {
      method: 'GET',
      path: '/api/users',
      state: { startTime: process.hrtime.bigint() - BigInt(10_000_000) }, // simulate 10ms
    } as any;

    const mockRes = {
      headersSent: true,
      statusCode: 200,
    } as any;

    // Trigger the hook twice to simulate two requests
    await hookFn(mockReq, mockRes);
    await hookFn(mockReq, mockRes);

    // Now call the /metrics endpoint
    const metricsReq = { headers: {} } as any;
    const metricsRes = { sendRaw: vi.fn() } as any;

    await routeFn(metricsReq, metricsRes);

    const output = metricsRes.sendRaw.mock.calls[0][0];

    expect(output).toContain(
      'http_requests_total{method="GET",route="/api/users",status="200"} 2',
    );
    expect(output).toContain(
      'http_request_duration_ms{method="GET",route="/api/users",status="200"}',
    );
    expect(metricsRes.sendRaw).toHaveBeenCalledWith(
      output,
      'text/plain; version=0.0.4',
    );
  });

  it('does not record metrics for the /metrics endpoint itself', async () => {
    const mockApp = { addHook: vi.fn(), route: vi.fn() } as any;
    useMetrics(mockApp);

    const hookFn = mockApp.addHook.mock.calls[0][1];

    const mockReq = { method: 'GET', path: '/metrics', state: {} } as any;
    const mockRes = {} as any; // Shouldn't be touched

    // If it didn't bail out early, it would throw trying to read res.headersSent
    expect(() => hookFn(mockReq, mockRes)).not.toThrow();
  });
});
