import * as fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serveStatic } from '../src/index';

// We mock fs to prevent actual disk reads during unit tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      stat: vi.fn().mockImplementation(async (filepath: string) => {
        if (filepath.includes('missing')) throw { code: 'ENOENT' };
        if (filepath.includes('directory')) return { isFile: () => false };
        return { isFile: () => true, size: 1024, mtime: new Date() };
      }),
    },
    createReadStream: vi.fn().mockReturnValue('mock-stream'),
  };
});

describe('serveStatic Plugin', () => {
  let statSpy: any;
  beforeEach(() => {
    statSpy = vi
      .spyOn(fs.promises, 'stat')
      .mockImplementation(async (filepath: any) => {
        if (filepath.includes('missing')) throw { code: 'ENOENT' };
        if (filepath.includes('directory'))
          return { isFile: () => false } as any;
        return { isFile: () => true, size: 1024, mtime: new Date() } as any;
      });
    vi.spyOn(fs, 'createReadStream').mockReturnValue('mock-stream' as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the wildcard route correctly', () => {
    const mockApp = { route: vi.fn() } as any;
    serveStatic(mockApp, { prefix: '/public', root: '/var/www' });

    expect(mockApp.route).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/public/*' }),
    );
  });

  it('securely resolves paths and blocks directory traversal', async () => {
    const mockApp = { route: vi.fn() } as any;
    serveStatic(mockApp, { prefix: '/assets', root: '/var/www/assets' });
    
    const handler = mockApp.route.mock.calls[0][0].handler;

    const mockReq = { params: { '*': '../../etc/passwd' }, headers: {} } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn(),
      stream: vi.fn(),
    } as any;

    await handler(mockReq, mockRes);

    // The fs mock above simulates a missing file, so we expect a 404.
    // The crucial part is verifying that the path passed to fs.stat was normalized
    // and stripped of the ../ attempts.
    const fs = require('fs');

    // Depending on OS path separators, it should evaluate to /var/www/assets/etc/passwd
    // instead of /var/etc/passwd
    const calledPath = statSpy.mock.calls[0][0];

    expect(calledPath.endsWith('etc/passwd')).toBe(true);
    expect(calledPath.includes('..')).toBe(false);
  });

  it('returns 404 for missing files', async () => {
    const mockApp = { route: vi.fn() } as any;
    serveStatic(mockApp, { prefix: '/assets', root: '/var/www' });

    const handler = mockApp.route.mock.calls[0][0].handler;

    const mockReq = { params: { '*': 'missing.js' }, headers: {} } as any;
    const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.send).toHaveBeenCalledWith(null, 'File not found');
  });

  it('returns 404 if path resolves to a directory', async () => {
    const mockApp = { route: vi.fn() } as any;
    serveStatic(mockApp, { prefix: '/assets', root: '/var/www' });

    const handler = mockApp.route.mock.calls[0][0].handler;

    const mockReq = { params: { '*': 'directory' }, headers: {} } as any;
    const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
  });
});
