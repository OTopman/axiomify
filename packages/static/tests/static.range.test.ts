import { Axiomify } from '@axiomify/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStatic } from '../src/index';

// 26 bytes, one per letter — offsets are easy to reason about.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

let tmpDir: string;
let filePath: string;
let fileStat: fs.Stats;
let etag: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiomify-range-'));
  filePath = path.join(tmpDir, 'alpha.txt');
  fs.writeFileSync(filePath, ALPHABET);
  fs.mkdirSync(path.join(tmpDir, 'spa'));
  fs.writeFileSync(path.join(tmpDir, 'spa', 'index.html'), '<html>spa</html>');
  fileStat = fs.statSync(filePath);
  etag = `W/"${fileStat.ino.toString(16)}-${fileStat.size.toString(16)}-${fileStat.mtime.getTime().toString(16)}"`;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeApp() {
  const app = new Axiomify();
  serveStatic(app, { prefix: '/f', root: tmpDir });
  return app;
}

function makeReq(file: string, headers: Record<string, string> = {}): any {
  return {
    id: 'r1',
    method: 'GET',
    url: `/f/${file}`,
    path: `/f/${file}`,
    ip: '127.0.0.1',
    headers,
    body: undefined,
    query: {},
    params: { '*': file },
    state: {},
    raw: {},
    stream: null,
  };
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: Promise<Buffer> | null = null;
  let sendRawPayload: unknown;
  let sendPayload: unknown;
  const res: any = {
    status(c: number) {
      statusCode = c;
      return res;
    },
    header(k: string, v: string) {
      headers[k] = v;
      return res;
    },
    getHeader: (k: string) => headers[k],
    removeHeader(k: string) {
      delete headers[k];
      return res;
    },
    send(data: unknown) {
      sendPayload = data;
    },
    sendRaw(payload: unknown) {
      sendRawPayload = payload;
    },
    stream(readable: Readable) {
      body = new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        readable.on('data', (c) => chunks.push(c));
        readable.on('end', () => resolve(Buffer.concat(chunks)));
        readable.on('error', reject);
      });
    },
    headersSent: false,
    raw: {},
    capabilities: { sse: false, streaming: true },
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
    get sendRawPayload() {
      return sendRawPayload;
    },
    get sendPayload() {
      return sendPayload;
    },
  };
  return res;
}

async function request(file: string, headers: Record<string, string> = {}) {
  const app = makeApp();
  const route = app.registeredRoutes.find((r) => r.path === '/f/*')!;
  const res = makeRes();
  await route.handler(makeReq(file, headers), res);
  return res;
}

describe('serveStatic — Range requests (RFC 9110)', () => {
  it('advertises Accept-Ranges: bytes on full file responses', async () => {
    const res = await request('alpha.txt');
    expect(res.statusCode).toBe(200);
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Content-Length']).toBe('26');
    expect(res.headers['Last-Modified']).toBe(fileStat.mtime.toUTCString());
    expect((await res.body).toString()).toBe(ALPHABET);
  });

  it('bytes=0-4 → 206 with the first five bytes', async () => {
    const res = await request('alpha.txt', { range: 'bytes=0-4' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-4/26');
    expect(res.headers['Content-Length']).toBe('5');
    expect((await res.body).toString()).toBe('abcde');
  });

  it('bytes=20- (open-ended) → 206 to end of file', async () => {
    const res = await request('alpha.txt', { range: 'bytes=20-' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 20-25/26');
    expect(res.headers['Content-Length']).toBe('6');
    expect((await res.body).toString()).toBe('uvwxyz');
  });

  it('bytes=-6 (suffix) → 206 with the final six bytes', async () => {
    const res = await request('alpha.txt', { range: 'bytes=-6' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 20-25/26');
    expect((await res.body).toString()).toBe('uvwxyz');
  });

  it('suffix longer than the file is clamped to the whole file', async () => {
    const res = await request('alpha.txt', { range: 'bytes=-999' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-25/26');
    expect((await res.body).toString()).toBe(ALPHABET);
  });

  it('end beyond file size is clamped to the last byte', async () => {
    const res = await request('alpha.txt', { range: 'bytes=10-9999' });
    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 10-25/26');
    expect((await res.body).toString()).toBe('klmnopqrstuvwxyz');
  });

  it('start >= size → 416 with Content-Range: bytes */26', async () => {
    const res = await request('alpha.txt', { range: 'bytes=26-' });
    expect(res.statusCode).toBe(416);
    expect(res.headers['Content-Range']).toBe('bytes */26');
    expect(res.body).toBeNull(); // no file bytes streamed
  });

  it('bytes=-0 (zero-length suffix) → 416', async () => {
    const res = await request('alpha.txt', { range: 'bytes=-0' });
    expect(res.statusCode).toBe(416);
    expect(res.headers['Content-Range']).toBe('bytes */26');
  });

  it('multi-range requests fall back to the full 200 response', async () => {
    const res = await request('alpha.txt', { range: 'bytes=0-1,3-4' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Range']).toBeUndefined();
    expect((await res.body).toString()).toBe(ALPHABET);
  });

  it.each([
    'bytes=abc-def',
    'bytes=-',
    'bytes=5-2', // last-byte-pos < first-byte-pos → invalid, ignore header
    'items=0-4', // unknown unit
    'bytes 0-4', // missing '='
  ])('malformed Range %s → full 200', async (range) => {
    const res = await request('alpha.txt', { range });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Range']).toBeUndefined();
    expect((await res.body).toString()).toBe(ALPHABET);
  });

  it('If-None-Match takes precedence over Range (304, no body)', async () => {
    const res = await request('alpha.txt', {
      range: 'bytes=0-4',
      'if-none-match': etag,
    });
    expect(res.statusCode).toBe(304);
    expect(res.sendRawPayload).toBe('');
    expect(res.body).toBeNull();
  });
});

describe('serveStatic — If-Range', () => {
  it('matching ETag → range honored (206)', async () => {
    const res = await request('alpha.txt', {
      range: 'bytes=0-4',
      'if-range': etag,
    });
    expect(res.statusCode).toBe(206);
    expect((await res.body).toString()).toBe('abcde');
  });

  it('stale ETag → full 200 representation', async () => {
    const res = await request('alpha.txt', {
      range: 'bytes=0-4',
      'if-range': 'W/"deadbeef-1a-0"',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Range']).toBeUndefined();
    expect((await res.body).toString()).toBe(ALPHABET);
  });

  it('HTTP-date at/after mtime → range honored (206)', async () => {
    const res = await request('alpha.txt', {
      range: 'bytes=-6',
      'if-range': new Date(fileStat.mtime.getTime() + 60_000).toUTCString(),
    });
    expect(res.statusCode).toBe(206);
    expect((await res.body).toString()).toBe('uvwxyz');
  });

  it('HTTP-date before mtime → full 200', async () => {
    const res = await request('alpha.txt', {
      range: 'bytes=-6',
      'if-range': new Date(fileStat.mtime.getTime() - 60_000).toUTCString(),
    });
    expect(res.statusCode).toBe(200);
    expect((await res.body).toString()).toBe(ALPHABET);
  });

  it('unparseable If-Range value → full 200', async () => {
    const res = await request('alpha.txt', {
      range: 'bytes=0-4',
      'if-range': 'not-a-date-or-etag',
    });
    expect(res.statusCode).toBe(200);
    expect((await res.body).toString()).toBe(ALPHABET);
  });
});

describe('serveStatic — Range interplay with existing behavior', () => {
  it('SPA index fallback ignores Range (directories are not real files)', async () => {
    const res = await request('spa', { range: 'bytes=0-2' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Range']).toBeUndefined();
    expect(res.headers['Accept-Ranges']).toBeUndefined();
    expect((await res.body).toString()).toBe('<html>spa</html>');
  });

  it('traversal protection still wins over Range', async () => {
    const res = await request('../../etc/passwd', { range: 'bytes=0-4' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toBeNull();
  });

  it('missing files still 404 with a Range header present', async () => {
    const res = await request('nope.txt', { range: 'bytes=0-4' });
    expect(res.statusCode).toBe(404);
  });
});
