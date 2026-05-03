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
        if (filepath.includes('directory')) return { isFile: () => false, isDirectory: () => true, size: 0, mtime: new Date() };
        return { isFile: () => true, isDirectory: () => false, size: 1024, mtime: new Date() };
      }),
      realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
    },
    createReadStream: vi.fn().mockReturnValue('mock-stream'),
  };
});

describe('serveStatic Plugin', () => {
  let statSpy: any;
  beforeEach(() => {
    vi.spyOn(fs.promises, 'realpath').mockImplementation((p: any) => Promise.resolve(String(p)));
    statSpy = vi
      .spyOn(fs.promises, 'stat')
      .mockImplementation(async (filepath: any) => {
        if (filepath.includes('missing')) throw { code: 'ENOENT' };
        if (filepath.includes('directory'))
          return { isFile: () => false, isDirectory: () => true, size: 0, mtime: new Date() } as any;
        return { isFile: () => true, isDirectory: () => false, size: 1024, mtime: new Date() } as any;
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

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.send).toHaveBeenCalledWith(null, 'Forbidden');
    expect(statSpy).not.toHaveBeenCalled();
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

  it('returns 403 if path resolves to a directory and serveIndex is disabled', async () => {
    const mockApp = { route: vi.fn() } as any;
    serveStatic(mockApp, { prefix: '/assets', root: '/var/www', serveIndex: false });

    const handler = mockApp.route.mock.calls[0][0].handler;

    const mockReq = { params: { '*': 'directory' }, headers: {} } as any;
    const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
  });
});

// ─── Configurable cacheControl option ────────────────────────────────────────

describe('serveStatic — cacheControl option', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (fs.promises as any).stat = vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 42,
      mtime: new Date('2024-01-01'),
    });
    (fs.promises as any).realpath = vi.fn().mockImplementation((p: string) => Promise.resolve(p));
    (fs as any).createReadStream = vi.fn().mockReturnValue('mock-stream');
  });

  it('uses default Cache-Control: public, max-age=86400 when cacheControl is omitted', async () => {
    const { Axiomify: A } = await import('../../core/src/app');
    const app = new A();
    serveStatic(app, { prefix: '/files', root: '/srv/public' });

    const route = app.registeredRoutes.find(r => r.path === '/files/*')!;
    const setCacheControl: string[] = [];
    const mockReq: any = {
      method: 'GET', path: '/files/test.txt', params: { '*': 'test.txt' }, headers: {}, state: {},
    };
    const mockRes: any = {
      header: (k: string, v: string) => { if (k === 'Cache-Control') setCacheControl.push(v); return mockRes; },
      stream: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    };

    await route.handler(mockReq, mockRes);
    expect(setCacheControl).toContain('public, max-age=86400');
  });

  it('uses custom cacheControl when specified', async () => {
    const { Axiomify: A } = await import('../../core/src/app');
    const app = new A();
    serveStatic(app, {
      prefix: '/assets',
      root: '/srv/assets',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    const route = app.registeredRoutes.find(r => r.path === '/assets/*')!;
    const setCacheControl: string[] = [];
    const mockReq: any = {
      method: 'GET', path: '/assets/app.js', params: { '*': 'app.js' }, headers: {}, state: {},
    };
    const mockRes: any = {
      header: (k: string, v: string) => { if (k === 'Cache-Control') setCacheControl.push(v); return mockRes; },
      stream: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    };

    await route.handler(mockReq, mockRes);
    expect(setCacheControl).toContain('public, max-age=31536000, immutable');
  });
});

// ─── Extended MIME types ──────────────────────────────────────────────────────

describe('serveStatic — extended MIME table', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (fs.promises as any).stat = vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 10,
      mtime: new Date('2024-01-01'),
    });
    (fs.promises as any).realpath = vi.fn().mockImplementation((p: string) => Promise.resolve(p));
    (fs as any).createReadStream = vi.fn().mockReturnValue('mock-stream');
  });

  const MIME_CASES = [
    ['test.webp', 'image/webp'],
    ['test.avif', 'image/avif'],
    ['test.wasm', 'application/wasm'],
    ['test.woff2', 'font/woff2'],
    ['test.csv',  'text/csv; charset=utf-8'],
    ['test.yaml', 'application/yaml'],
    ['test.pdf',  'application/pdf'],
    ['test.ico',  'image/x-icon'],
    ['test.mp3',  'audio/mpeg'],
    ['unknown.xyz', 'application/octet-stream'],
  ] as const;

  it.each(MIME_CASES)('serves %s with Content-Type %s', async (filename, expectedMime) => {
    const { Axiomify: A } = await import('../../core/src/app');
    const app = new A();
    serveStatic(app, { prefix: '/m', root: '/srv/m' });

    const route = app.registeredRoutes.find(r => r.path === '/m/*')!;
    let capturedMime = '';
    const mockReq: any = {
      method: 'GET', path: `/m/${filename}`, params: { '*': filename }, headers: {}, state: {},
    };
    const mockRes: any = {
      header: vi.fn().mockReturnThis(),
      stream: (_s: unknown, ct: string) => { capturedMime = ct; },
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    };

    await route.handler(mockReq, mockRes);
    expect(capturedMime).toBe(expectedMime);
  });
});
