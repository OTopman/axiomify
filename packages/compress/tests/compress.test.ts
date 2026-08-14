import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import {
  disableCompression,
  useCompress,
  ZSTD_SUPPORTED,
  type CompressEncoding,
} from '../src/index';

// ── Mocks (à la packages/core/tests/app.extra.test.ts) ───────────────────────

function makeReq(overrides: any = {}): any {
  return {
    id: 'r1',
    method: 'GET',
    url: '/',
    path: '/',
    ip: '127.0.0.1',
    headers: {},
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  };
}

interface Captured {
  kind: 'send' | 'sendRaw' | 'stream' | null;
  payload: any;
  message?: string;
  contentType?: string;
  readable?: Readable;
  count: number;
}

function makeRes() {
  const headers: Record<string, string> = {};
  let sent = false;
  let statusCode = 200;
  const captured: Captured = { kind: null, payload: undefined, count: 0 };

  let resolveEmitted!: () => void;
  const emitted = new Promise<void>((r) => (resolveEmitted = r));

  const res: any = {
    status: vi.fn((c: number) => {
      statusCode = c;
      return res;
    }),
    header: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn((k: string) => {
      delete headers[k];
      return res;
    }),
    send: vi.fn((data: any, message?: string) => {
      sent = true;
      captured.kind = 'send';
      captured.payload = data;
      captured.message = message;
      captured.count++;
      resolveEmitted();
    }),
    sendRaw: vi.fn((payload: any, contentType?: string) => {
      sent = true;
      captured.kind = 'sendRaw';
      captured.payload = payload;
      captured.contentType = contentType;
      captured.count++;
      resolveEmitted();
    }),
    stream: vi.fn((readable: Readable, contentType?: string) => {
      sent = true;
      captured.kind = 'stream';
      captured.readable = readable;
      captured.contentType = contentType;
      captured.count++;
      resolveEmitted();
    }),
    get headersSent() {
      return sent;
    },
    get statusCode() {
      return statusCode;
    },
    raw: {},
    capabilities: { sse: false, streaming: true },
    get headers() {
      return headers;
    },
  };
  return { res, headers, captured, emitted };
}

function decompress(payload: Buffer, encoding: CompressEncoding): Buffer {
  switch (encoding) {
    case 'br':
      return zlib.brotliDecompressSync(payload);
    case 'gzip':
      return zlib.gunzipSync(payload);
    case 'deflate':
      return zlib.inflateSync(payload);
    /* v8 ignore next 2 */
    default:
      throw new Error(`cannot decompress ${encoding}`);
  }
}

function collect(readable: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on('data', (c) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
    );
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

// A payload comfortably above the default 1024-byte threshold once wrapped
// in the default serializer envelope.
const BIG = 'x'.repeat(4096);

function makeApp(
  options?: Parameters<typeof useCompress>[1],
  routeOpts: { plugins?: any[]; handler?: any } = {},
) {
  const app = new Axiomify();
  useCompress(app, options);
  app.route({
    method: 'GET',
    path: '/data',
    plugins: routeOpts.plugins,
    handler:
      routeOpts.handler ??
      (async (_req: any, res: any) => {
        res.send({ blob: BIG });
      }),
  });
  return app;
}

// Expected JSON body: replicate the default serializer envelope.
function envelope(data: any, message?: string) {
  return JSON.stringify({
    status: 'success',
    message: message || 'Operation successful',
    data,
  });
}

describe('useCompress — Accept-Encoding negotiation', () => {
  const MATRIX: Array<[string | undefined, CompressEncoding | null]> = [
    ['br', 'br'],
    ['gzip', 'gzip'],
    ['deflate', 'deflate'],
    ['gzip, br', 'br'], // equal q → server preference (br first)
    ['gzip, deflate', 'gzip'],
    ['gzip;q=1, br;q=0.5', 'gzip'], // client q beats server order
    ['br;q=0.8, gzip;q=0.9, deflate;q=0.1', 'gzip'],
    ['gzip;q=0', null], // q=0 excludes
    ['gzip;q=0, br;q=0', null],
    ['*', 'br'], // wildcard → best server pick
    ['*;q=0', null], // wildcard exclusion
    ['*;q=0, gzip', 'gzip'],
    ['identity', null],
    ['identity;q=0, br', 'br'],
    ['identity;q=1, gzip;q=0.4', null], // explicit identity preferred
    ['unknown-token', null],
    ['', null],
    [undefined, null], // no header → identity
  ];

  it.each(MATRIX)('Accept-Encoding: %s → %s', async (header, expected) => {
    const app = makeApp();
    const req = makeReq({
      path: '/data',
      headers: header === undefined ? {} : { 'accept-encoding': header },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    if (expected === null) {
      expect(headers['Content-Encoding']).toBeUndefined();
      expect(captured.kind).toBe('send');
    } else {
      expect(headers['Content-Encoding']).toBe(expected);
      expect(captured.kind).toBe('sendRaw');
      expect(captured.contentType).toBe('application/json');
      const out = decompress(captured.payload, expected).toString();
      expect(out).toBe(envelope({ blob: BIG }));
    }
  });

  it('joins array-valued accept-encoding headers before negotiating', async () => {
    const app = makeApp();
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': ['identity;q=0', 'gzip'] },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(decompress(captured.payload, 'gzip').toString()).toBe(
      envelope({ blob: BIG }),
    );
  });

  it('ignores malformed q-values (treated as q=1)', async () => {
    const app = makeApp();
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip;q=abc' },
    });
    const { res, headers, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBe('gzip');
  });
});

describe('useCompress — round-trips', () => {
  it.each(['br', 'gzip', 'deflate'] as const)(
    '%s round-trip preserves the serialized body and status code',
    async (enc) => {
      const app = makeApp(undefined, {
        handler: async (_req: any, res: any) => {
          res.status(201).send({ blob: BIG }, 'created');
        },
      });
      const req = makeReq({
        path: '/data',
        headers: { 'accept-encoding': enc },
      });
      const { res, headers, captured, emitted } = makeRes();
      await app.handle(req, res);
      await emitted;

      expect(headers['Content-Encoding']).toBe(enc);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(decompress(captured.payload, enc).toString());
      expect(body).toMatchObject({ message: 'created', data: { blob: BIG } });
    },
  );

  it('sendRaw string round-trip', async () => {
    const html = `<html>${'y'.repeat(3000)}</html>`;
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.sendRaw(html, 'text/html; charset=utf-8');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(headers['Content-Encoding']).toBe('gzip');
    expect(captured.contentType).toBe('text/html; charset=utf-8');
    expect(zlib.gunzipSync(captured.payload).toString()).toBe(html);
  });

  it('sendRaw Buffer round-trip via brotli', async () => {
    const buf = Buffer.from('z'.repeat(5000));
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.sendRaw(buf, 'application/json');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(headers['Content-Encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(captured.payload).equals(buf)).toBe(true);
  });

  it('stream round-trip: pipes through the zlib transform', async () => {
    const chunks = ['first-chunk-', 'second-chunk-', 'third-chunk'];
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.stream(Readable.from(chunks), 'text/plain; charset=utf-8');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    // Content-Encoding must be set before stream() flushes headers.
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(captured.kind).toBe('stream');
    expect(captured.contentType).toBe('text/plain; charset=utf-8');
    const compressed = await collect(captured.readable!);
    expect(zlib.gunzipSync(compressed).toString()).toBe(chunks.join(''));
  });

  it('honors gzipOptions (level 1 output still decompresses)', async () => {
    const app = makeApp(
      { gzipOptions: { level: 1 } },
      {
        handler: async (_req: any, res: any) => {
          res.sendRaw(BIG, 'text/plain');
        },
      },
    );
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(zlib.gunzipSync(captured.payload).toString()).toBe(BIG);
  });

  it('honors brotliOptions (quality 1 output still decompresses)', async () => {
    const app = makeApp(
      {
        brotliOptions: {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 },
        },
      },
      {
        handler: async (_req: any, res: any) => {
          res.sendRaw(BIG, 'text/plain');
        },
      },
    );
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br' },
    });
    const { res, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(zlib.brotliDecompressSync(captured.payload).toString()).toBe(BIG);
  });
});

describe('useCompress — guards', () => {
  it('below-threshold payloads pass through uncompressed (default 1024)', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.send({ tiny: true });
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(headers['Content-Encoding']).toBeUndefined();
    // Delegates via sendRaw with the already-serialized body — reusing the
    // serializer pass this wrapper already did, instead of re-invoking
    // send() with the raw data (which would force a second serializer pass
    // in any plugin wrapped underneath, e.g. @axiomify/cache).
    expect(captured.kind).toBe('sendRaw');
    expect(captured.contentType).toBe('application/json');
    expect(JSON.parse(captured.payload as string)).toEqual({
      status: 'success',
      message: 'Operation successful',
      data: { tiny: true },
    });
    // Vary still applies — the route is eligible, only the payload is small.
    expect(headers['Vary']).toBe('Accept-Encoding');
  });

  it('custom threshold is respected', async () => {
    const app = makeApp(
      { threshold: 10 },
      {
        handler: async (_req: any, res: any) => {
          res.sendRaw('0123456789ABCDEF', 'text/plain');
        },
      },
    );
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(zlib.gunzipSync(captured.payload).toString()).toBe(
      '0123456789ABCDEF',
    );
  });

  it('MIME filter: non-allowlisted types pass through without Vary', async () => {
    const png = Buffer.alloc(4096, 7);
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.sendRaw(png, 'image/png');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(headers['Content-Encoding']).toBeUndefined();
    expect(headers['Vary']).toBeUndefined();
    expect(captured.payload).toBe(png);
  });

  it('MIME filter: custom compressibleTypes replaces the default allowlist', async () => {
    const app = makeApp(
      { compressibleTypes: ['application/wasm'] },
      {
        handler: async (_req: any, res: any) => {
          res.sendRaw(BIG, 'text/html'); // no longer allowlisted
        },
      },
    );
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBeUndefined();
  });

  it('text/event-stream is never compressed even though text/* matches', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.stream(Readable.from([BIG]), 'text/event-stream');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBeUndefined();
    expect((await collect(captured.readable!)).toString()).toBe(BIG);
  });

  it('Cache-Control: no-transform skips compression', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.header('Cache-Control', 'public, no-transform, max-age=60');
        res.send({ blob: BIG });
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBeUndefined();
    expect(captured.kind).toBe('send');
  });

  it('a pre-set Content-Encoding header skips compression', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.header('Content-Encoding', 'gzip'); // already encoded upstream
        res.sendRaw(BIG, 'text/plain');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBe('gzip'); // untouched
    expect(captured.payload).toBe(BIG); // not re-compressed
  });

  it('206 partial responses are not compressed', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.status(206);
        res.header('Content-Range', 'bytes 0-4095/8192');
        res.stream(Readable.from([BIG]), 'text/plain');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBeUndefined();
    expect((await collect(captured.readable!)).toString()).toBe(BIG);
  });

  it('HEAD requests are delegated with no compressed body', async () => {
    const app = new Axiomify();
    useCompress(app);
    app.route({
      method: 'HEAD',
      path: '/data',
      handler: async (_req: any, res: any) => {
        res.send({ blob: BIG });
      },
    });
    const req = makeReq({
      path: '/data',
      method: 'HEAD',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(headers['Content-Encoding']).toBeUndefined();
    expect(captured.kind).toBe('send'); // adapter suppresses the body itself
    expect(headers['Vary']).toBe('Accept-Encoding'); // headers mirror GET
  });

  it('double-send: second send() during in-flight compression is dropped', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.send({ blob: BIG });
        res.send({ blob: 'second' }); // must be latched out synchronously
        res.sendRaw('third', 'text/plain');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(captured.count).toBe(1);
    expect(decompress(captured.payload, 'gzip').toString()).toBe(
      envelope({ blob: BIG }),
    );
  });

  it('stream after send is dropped by the latch', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.send({ blob: BIG });
        res.stream(Readable.from(['nope']), 'text/plain');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br' },
    });
    const { res, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(captured.count).toBe(1);
    expect(captured.kind).toBe('sendRaw');
  });

  it('non-string/Buffer sendRaw payloads pass through untouched', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.sendRaw(12345 as any, 'text/plain');
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBeUndefined();
    expect(captured.payload).toBe(12345);
  });
});

describe('useCompress — Vary header', () => {
  it('appends Vary: Accept-Encoding even when the client sends no Accept-Encoding', async () => {
    const app = makeApp();
    const req = makeReq({ path: '/data', headers: {} });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(headers['Vary']).toBe('Accept-Encoding');
    expect(headers['Content-Encoding']).toBeUndefined();
    expect(captured.kind).toBe('send');
  });

  it('merges with an existing Vary value without duplicating', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.header('Vary', 'Origin');
        res.send({ blob: BIG });
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Vary']).toBe('Origin, Accept-Encoding');
  });

  it('does not duplicate an existing Accept-Encoding entry (case-insensitive)', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.header('Vary', 'accept-encoding');
        res.send({ blob: BIG });
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Vary']).toBe('accept-encoding');
  });

  it('leaves Vary: * untouched', async () => {
    const app = makeApp(undefined, {
      handler: async (_req: any, res: any) => {
        res.header('Vary', '*');
        res.send({ blob: BIG });
      },
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, headers, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Vary']).toBe('*');
  });
});

describe('disableCompression', () => {
  it('as a route plugin, opts the route out of compression', async () => {
    const app = makeApp(undefined, {
      plugins: [disableCompression],
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;

    expect(headers['Content-Encoding']).toBeUndefined();
    expect(captured.kind).toBe('send');
    expect(captured.payload).toEqual({ blob: BIG });
  });

  it('works with a core-style state object exposing get/set', async () => {
    const store = new Map<string, unknown>();
    const state = {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => {
        if (store.has(k)) throw new Error(`immutable key ${k}`);
        store.set(k, v);
      },
    };
    const req = makeReq({ state });
    await disableCompression(req, makeRes().res);
    // A second application must not throw against immutable state keys.
    await disableCompression(req, makeRes().res);
    expect(store.get('axiomify:compress:disabled')).toBe(true);
  });

  it('works with a plain-object state (mock adapters)', async () => {
    const req = makeReq({ state: {} });
    await disableCompression(req, makeRes().res);
    expect(req.state['axiomify:compress:disabled']).toBe(true);
  });
});

describe('useCompress — options validation & zstd feature detection', () => {
  it('throws on unknown encodings', () => {
    const app = new Axiomify();
    expect(() => useCompress(app, { encodings: ['snappy' as any] })).toThrow(
      /Unknown encoding "snappy"/,
    );
  });

  it('drops zstd with a warning when the runtime lacks it', async () => {
    // Only meaningful on runtimes without zlib zstd (Node < 23.8).
    if (ZSTD_SUPPORTED) return;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = new Axiomify();
      useCompress(app, { encodings: ['zstd', 'gzip'] });
      app.route({
        method: 'GET',
        path: '/data',
        handler: async (_req: any, res: any) => res.send({ blob: BIG }),
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('zstd'));

      // zstd never gets negotiated — gzip is served instead.
      const req = makeReq({
        path: '/data',
        headers: { 'accept-encoding': 'zstd, gzip' },
      });
      const { res, headers, emitted } = makeRes();
      await app.handle(req, res);
      await emitted;
      expect(headers['Content-Encoding']).toBe('gzip');
    } finally {
      warn.mockRestore();
    }
  });

  it('restricting encodings limits what gets negotiated', async () => {
    const app = makeApp({ encodings: ['gzip'] });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'br, gzip;q=0.5' },
    });
    const { res, headers, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(decompress(captured.payload, 'gzip').toString()).toBe(
      envelope({ blob: BIG }),
    );
  });

  it('uses a custom serializer set via app.setSerializer', async () => {
    const app = new Axiomify();
    useCompress(app);
    app.setSerializer(({ data }: any) => ({ wrapped: data }));
    app.route({
      method: 'GET',
      path: '/data',
      handler: async (_req: any, res: any) => res.send({ blob: BIG }),
    });
    const req = makeReq({
      path: '/data',
      headers: { 'accept-encoding': 'gzip' },
    });
    const { res, captured, emitted } = makeRes();
    await app.handle(req, res);
    await emitted;
    expect(JSON.parse(zlib.gunzipSync(captured.payload).toString())).toEqual({
      wrapped: { blob: BIG },
    });
  });
});
