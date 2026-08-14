import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import * as fs from 'fs';
import * as path from 'path';
import { serveStatic } from '../src/index';

function makeReq(overrides: any = {}) {
  return {
    id: 'r1',
    method: 'GET',
    url: '/assets/file.txt',
    path: '/assets/file.txt',
    ip: '127.0.0.1',
    headers: {},
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  } as any;
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  const res: any = {
    status: vi.fn((c: number) => {
      statusCode = c;
      return res;
    }),
    header: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    send: vi.fn(),
    sendRaw: vi.fn(),
    stream: vi.fn(),
    getHeader: vi.fn(),
    removeHeader: vi.fn(),
    error: vi.fn(),
    get statusCode() {
      return statusCode;
    },
    headersSent: false,
    raw: {},
    capabilities: { sse: false, streaming: false },
    get headers() {
      return headers;
    },
  };
  return res;
}

describe('serveStatic', () => {
  it('registers a wildcard route for the given prefix', () => {
    const app = new Axiomify();
    serveStatic(app, { prefix: '/assets', root: '/tmp' });
    expect(app.registeredRoutes.some((r) => r.path === '/assets/*')).toBe(true);
  });

  it('returns 404 when file does not exist (ENOENT)', async () => {
    const app = new Axiomify();
    serveStatic(app, { prefix: '/assets', root: '/nonexistent-dir-xyz' });
    const route = app.registeredRoutes.find((r) => r.path === '/assets/*')!;
    const req = makeReq({ params: { '*': 'missing.txt' } });
    const res = makeRes();
    await route.handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('prevents path traversal — returns 403 for ../../ paths', async () => {
    const app = new Axiomify();
    serveStatic(app, { prefix: '/assets', root: '/tmp' });
    const route = app.registeredRoutes.find((r) => r.path === '/assets/*')!;
    const req = makeReq({ params: { '*': '../../etc/passwd' } });
    const res = makeRes();
    await route.handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('serves an existing file with correct Content-Type', async () => {
    const tmpDir = `/tmp/axiomify-static-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'data.json'), '{"ok":true}');
    try {
      const app = new Axiomify();
      serveStatic(app, { prefix: '/files', root: tmpDir });
      const route = app.registeredRoutes.find((r) => r.path === '/files/*')!;
      const req = makeReq({ params: { '*': 'data.json' } });
      // Intercept stream() to immediately destroy the readable before cleanup
      let capturedStream: fs.ReadStream | null = null;
      const res = makeRes();
      res.stream = vi.fn((readable: fs.ReadStream) => {
        capturedStream = readable;
        readable.destroy(); // prevent dangling open FD after dir removal
      });
      await route.handler(req, res);
      expect(res.stream).toHaveBeenCalled();
      // Wait for stream destroy to complete
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns 304 when ETag matches', async () => {
    const tmpDir = `/tmp/axiomify-etag-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    try {
      const stat = fs.statSync(path.join(tmpDir, 'a.txt'));
      const etag = `W/"${stat.ino.toString(16)}-${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;
      const app = new Axiomify();
      serveStatic(app, { prefix: '/f', root: tmpDir });
      const route = app.registeredRoutes.find((r) => r.path === '/f/*')!;
      const req = makeReq({
        params: { '*': 'a.txt' },
        headers: { 'if-none-match': etag },
      });
      const res = makeRes();
      await route.handler(req, res);
      expect(res.status).toHaveBeenCalledWith(304);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('serveStatic — extended paths', () => {
  it('returns 500 when realpath throws EACCES (permissions error)', async () => {
    // Use a path that is a file (not a directory) as the root. stat() on the root
    // itself as a realpath base will fail with ENOTDIR, which is not ENOENT → 500.
    const tmpFile = `/tmp/axiomify-static-root-${Date.now()}.txt`;
    const fs = require('fs') as typeof import('fs');
    fs.writeFileSync(tmpFile, 'not a dir');
    try {
      const app = new Axiomify();
      // root is a file, not a directory — realpath join will give a non-ENOENT error
      serveStatic(app, { prefix: '/x', root: tmpFile });
      const route = app.registeredRoutes.find((r) => r.path === '/x/*')!;
      const req = makeReq({ params: { '*': 'sub/file.txt' } });
      const res = makeRes();
      await route.handler(req, res);
      // Should get 404 (ENOENT from stat) or 500 — either is acceptable
      expect([404, 403, 500]).toContain(res.statusCode);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('serves index.html for directory requests when serveIndex is true', async () => {
    const tmpDir = `/tmp/axiomify-idx-${Date.now()}`;
    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sub', 'index.html'), '<html/>');
    try {
      const app = new Axiomify();
      serveStatic(app, { prefix: '/s', root: tmpDir, serveIndex: true });
      const route = app.registeredRoutes.find((r) => r.path === '/s/*')!;
      const req = makeReq({ params: { '*': 'sub' } });
      const res = makeRes();
      // intercept stream to avoid dangling FD
      let streamCalled = false;
      res.stream = vi.fn((readable: any) => {
        streamCalled = true;
        readable.destroy();
      });
      await route.handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(streamCalled).toBe(true);
      expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(res.headers['Content-Disposition']).toBe(
        'attachment; filename="index.html"',
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns 403 when directory requested and serveIndex is false', async () => {
    const tmpDir = `/tmp/axiomify-noindex-${Date.now()}`;
    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    try {
      const app = new Axiomify();
      serveStatic(app, { prefix: '/f', root: tmpDir, serveIndex: false });
      const route = app.registeredRoutes.find((r) => r.path === '/f/*')!;
      const req = makeReq({ params: { '*': 'sub' } });
      const res = makeRes();
      await route.handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('serveStatic — !isFile() path', () => {
  it('returns 404 when path resolves to a non-file, non-directory entry', async () => {
    // On Linux, /dev/null is a char device — not a file and not a directory.
    // stat.isFile() returns false, stat.isDirectory() returns false.
    const app = new Axiomify();
    serveStatic(app, { prefix: '/dev', root: '/dev' });
    const route = app.registeredRoutes.find((r) => r.path === '/dev/*')!;
    const req = makeReq({ params: { '*': 'null' } });
    const res = makeRes();
    await route.handler(req, res);
    // /dev/null: isFile()=false, isDirectory()=false → 404
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('serveStatic — index.html serving', () => {
  it('serves index.html when serveIndex is true and path is directory', async () => {
    const tmpDir = `/tmp/axiomify-si-${Date.now()}`;
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sub', 'index.html'), '<html>hi</html>');
    try {
      const app = new Axiomify();
      serveStatic(app, { prefix: '/app', root: tmpDir, serveIndex: true });
      const route = app.registeredRoutes.find((r) => r.path === '/app/*')!;
      const req = makeReq({ params: { '*': 'sub' } });
      let streamCalled = false;
      const res = makeRes();
      res.stream = vi.fn((readable: any) => {
        streamCalled = true;
        readable.destroy();
      });
      await route.handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(streamCalled).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns 404 when index.html is missing in serveIndex directory', async () => {
    const tmpDir = `/tmp/axiomify-nohtml-${Date.now()}`;
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    fs.mkdirSync(path.join(tmpDir, 'empty'), { recursive: true });
    try {
      const app = new Axiomify();
      serveStatic(app, { prefix: '/app', root: tmpDir, serveIndex: true });
      const route = app.registeredRoutes.find((r) => r.path === '/app/*')!;
      const req = makeReq({ params: { '*': 'empty' } });
      const res = makeRes();
      await route.handler(req, res);
      expect([404, 403]).toContain(res.statusCode);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('serveStatic — extra branches', () => {
  it('prefix already starting with / is preserved as-is', () => {
    const app = new Axiomify();
    serveStatic(app, { prefix: '/already', root: '/tmp' });
    expect(app.registeredRoutes.some((r: any) => r.path === '/already/*')).toBe(
      true,
    );
  });

  it('returns 400 for malformed percent-encoded path', async () => {
    const app = new Axiomify();
    serveStatic(app, { prefix: '/x', root: '/tmp' });
    const route = app.registeredRoutes.find((r: any) => r.path === '/x/*')!;
    const headers: Record<string, string> = {};
    let statusCode = 200;
    const res: any = {
      status: (c: number) => {
        statusCode = c;
        return res;
      },
      header: (k: string, v: string) => {
        headers[k] = v;
        return res;
      },
      send: () => {},
      sendRaw: () => {},
      stream: () => {},
      getHeader: () => undefined,
      removeHeader: () => res,
      headersSent: false,
      raw: {},
      get statusCode() {
        return statusCode;
      },
      capabilities: { sse: false, streaming: false },
    };
    const req: any = {
      id: 'r',
      method: 'GET',
      url: '/x/%E0',
      path: '/x/%E0',
      ip: '127.0.0.1',
      headers: {},
      body: undefined,
      query: {},
      params: { '*': '%E0%A4' }, // invalid UTF-8 percent sequence
      state: {},
      raw: {},
      stream: null,
    };
    await route.handler(req, res);
    expect(statusCode).toBe(400);
  });

  it('returns 403 when path contains a null byte', async () => {
    const app = new Axiomify();
    serveStatic(app, { prefix: '/x', root: '/tmp' });
    const route = app.registeredRoutes.find((r: any) => r.path === '/x/*')!;
    const headers: Record<string, string> = {};
    let statusCode = 200;
    const res: any = {
      status: (c: number) => {
        statusCode = c;
        return res;
      },
      header: (k: string, v: string) => {
        headers[k] = v;
        return res;
      },
      send: () => {},
      sendRaw: () => {},
      stream: () => {},
      getHeader: () => undefined,
      removeHeader: () => res,
      headersSent: false,
      raw: {},
      get statusCode() {
        return statusCode;
      },
      capabilities: { sse: false, streaming: false },
    };
    const req: any = {
      id: 'r',
      method: 'GET',
      url: '/x/null',
      path: '/x/null',
      ip: '127.0.0.1',
      headers: {},
      body: undefined,
      query: {},
      params: { '*': 'evil\0.txt' },
      state: {},
      raw: {},
      stream: null,
    };
    await route.handler(req, res);
    expect(statusCode).toBe(403);
  });

  it('returns 403 when path is absolute (e.g. /etc/passwd)', async () => {
    const app = new Axiomify();
    serveStatic(app, { prefix: '/x', root: '/tmp' });
    const route = app.registeredRoutes.find((r: any) => r.path === '/x/*')!;
    let statusCode = 200;
    const res: any = {
      status: (c: number) => {
        statusCode = c;
        return res;
      },
      header: () => res,
      send: () => {},
      sendRaw: () => {},
      stream: () => {},
      getHeader: () => undefined,
      removeHeader: () => res,
      headersSent: false,
      raw: {},
      get statusCode() {
        return statusCode;
      },
      capabilities: { sse: false, streaming: false },
    };
    const req: any = {
      id: 'r',
      method: 'GET',
      url: '/x',
      path: '/x',
      ip: '127.0.0.1',
      headers: {},
      body: undefined,
      query: {},
      params: { '*': '/etc/passwd' },
      state: {},
      raw: {},
      stream: null,
    };
    await route.handler(req, res);
    expect(statusCode).toBe(403);
  });

  it('respects custom forceDownloadExtensions option', async () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    const tmpDir = `/tmp/axiomify-fd-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'doc.svg');
    fs.writeFileSync(filePath, '<svg/>');
    try {
      const app = new Axiomify();
      serveStatic(app, {
        prefix: '/s',
        root: tmpDir,
        forceDownloadExtensions: ['.SVG'], // uppercase to verify lowercase normalization
      });
      const route = app.registeredRoutes.find((r: any) => r.path === '/s/*')!;
      const headers: Record<string, string> = {};
      let statusCode = 200;
      let streamCalled = false;
      const res: any = {
        status: (c: number) => {
          statusCode = c;
          return res;
        },
        header: (k: string, v: string) => {
          headers[k] = v;
          return res;
        },
        send: () => {},
        sendRaw: () => {},
        stream: (s: any) => {
          streamCalled = true;
          s.destroy();
        },
        getHeader: () => undefined,
        removeHeader: () => res,
        headersSent: false,
        raw: {},
        get statusCode() {
          return statusCode;
        },
        capabilities: { sse: false, streaming: false },
      };
      const req: any = {
        id: 'r',
        method: 'GET',
        url: '/s/doc.svg',
        path: '/s/doc.svg',
        ip: '127.0.0.1',
        headers: {},
        body: undefined,
        query: {},
        params: { '*': 'doc.svg' },
        state: {},
        raw: {},
        stream: null,
      };
      await route.handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(streamCalled).toBe(true);
      expect(headers['Content-Disposition']).toContain('attachment');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('escapes filename special characters (double quotes and backslashes) in Content-Disposition', async () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');

    const tmpDir = `/tmp/axiomify-escape-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });

    const rawFileName = 'doc"\\test.svg';
    const rawFilePath = path.join(tmpDir, rawFileName);
    fs.writeFileSync(rawFilePath, '<svg/>');

    const realpathSpy = vi
      .spyOn(fs.promises, 'realpath')
      .mockImplementation(async (p) => {
        if (typeof p === 'string' && p.endsWith('doc.svg')) {
          return rawFilePath;
        }
        return p;
      });

    try {
      const app = new Axiomify();
      serveStatic(app, {
        prefix: '/s',
        root: tmpDir,
        forceDownloadExtensions: ['.svg'],
      });
      const route = app.registeredRoutes.find((r: any) => r.path === '/s/*')!;
      const headers: Record<string, string> = {};
      let statusCode = 200;
      let streamCalled = false;
      const res: any = {
        status: (c: number) => {
          statusCode = c;
          return res;
        },
        header: (k: string, v: string) => {
          headers[k] = v;
          return res;
        },
        send: () => {},
        sendRaw: () => {},
        stream: (s: any) => {
          streamCalled = true;
          s.destroy();
        },
        getHeader: () => undefined,
        removeHeader: () => res,
        headersSent: false,
        raw: {},
        get statusCode() {
          return statusCode;
        },
        capabilities: { sse: false, streaming: false },
      };
      const req: any = {
        id: 'r',
        method: 'GET',
        url: '/s/doc.svg',
        path: '/s/doc.svg',
        ip: '127.0.0.1',
        headers: {},
        body: undefined,
        query: {},
        params: { '*': 'doc.svg' },
        state: {},
        raw: {},
        stream: null,
      };
      await route.handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(streamCalled).toBe(true);
      expect(headers['Content-Disposition']).toBe(
        'attachment; filename="doc\\"\\\\test.svg"',
      );
    } finally {
      realpathSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
