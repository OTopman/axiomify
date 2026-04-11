import * as jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { useAuth } from '../src/index';

describe('useAuth Plugin', () => {
  const SECRET = 'test-secret';

  const makeMocks = (authHeader?: string | string[]) => {
    const mockReq = { headers: { authorization: authHeader } } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;
    return { mockReq, mockRes };
  };

  it('authenticates a valid JWT and assigns req.user', async () => {
    const mockApp = { registerPlugin: vi.fn() } as any;
    useAuth(mockApp, { secret: SECRET });

    const pluginFn = mockApp.registerPlugin.mock.calls[0][1];

    // Generate a real token
    const token = jwt.sign({ id: 'user_123', role: 'admin' }, SECRET);
    const { mockReq, mockRes } = makeMocks(`Bearer ${token}`);

    await pluginFn(mockReq, mockRes);

    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockReq.user).toBeDefined();
    expect(mockReq.user.id).toBe('user_123');
    expect(mockReq.user.role).toBe('admin');
  });

  it('safely extracts tokens when authorization header is an array', async () => {
    const mockApp = { registerPlugin: vi.fn() } as any;
    useAuth(mockApp, { secret: SECRET });

    const pluginFn = mockApp.registerPlugin.mock.calls[0][1];
    const token = jwt.sign({ id: 'array_user' }, SECRET);

    // Node.js occasionally parses duplicated headers as an array
    const { mockReq, mockRes } = makeMocks([`Bearer ${token}`, 'other-value']);

    await pluginFn(mockReq, mockRes);

    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockReq.user.id).toBe('array_user');
  });

  it('returns 401 if token is missing entirely', async () => {
    const mockApp = { registerPlugin: vi.fn() } as any;
    useAuth(mockApp, { secret: SECRET });

    const pluginFn = mockApp.registerPlugin.mock.calls[0][1];
    const { mockReq, mockRes } = makeMocks(undefined);

    await pluginFn(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.send).toHaveBeenCalledWith(
      null,
      'Unauthorized: Missing token',
    );
  });

  it('returns 401 if token is invalid or tampered', async () => {
    const mockApp = { registerPlugin: vi.fn() } as any;
    useAuth(mockApp, { secret: SECRET });

    const pluginFn = mockApp.registerPlugin.mock.calls[0][1];
    const { mockReq, mockRes } = makeMocks('Bearer fake-tampered-token');

    await pluginFn(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.send).toHaveBeenCalledWith(
      null,
      'Unauthorized: Invalid or expired token',
    );
  });
});
