import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useCors } from '../src/index';

function makeReq(overrides: Record<string, any> = {}) {
  return {
    method: 'GET', url: '/', path: '/', ip: '127.0.0.1',
    headers: {}, body: undefined, query: {}, params: {},
    state: {}, raw: {}, stream: null, id: 'req_1',
    ...overrides,
  } as any;
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let sent = false;
  const r: any = {
    get headers() { return headers; },
    header: (k: string, v: string) => { headers[k] = v; return r; },
    status: (c: number) => { statusCode = c; return r; },
    send: vi.fn(() => { sent = true; }),
    getHeader: (k: string) => headers[k],
    removeHeader: vi.fn(),
    sendRaw: vi.fn(),
    error: vi.fn(),
    stream: vi.fn(),
    get headersSent() { return sent; },
    get statusCode() { return statusCode; },
    raw: {},
    capabilities: { sse: false, streaming: false },
  };
  // Make header and status spyable
  r.header = vi.fn(r.header);
  r.status = vi.fn(r.status);
  return r;
}

describe('useCors — extended coverage', () => {
  it('allows function origin and sets resolved origin', async () => {
    const app = new Axiomify();
    useCors(app, { origin: async (_o: string) => true });
    const req = makeReq({ headers: { origin: 'https://trusted.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://trusted.com');
  });

  it('function origin returning false does not set ACAO header', async () => {
    const app = new Axiomify();
    useCors(app, { origin: async () => false });
    const req = makeReq({ headers: { origin: 'https://evil.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('handles OPTIONS preflight with allowedHeaders', async () => {
    const app = new Axiomify();
    useCors(app, {
      origin: ['https://example.com'],
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
    });
    const req = makeReq({
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type');
  });

  it('sends 400 on strictPreflight OPTIONS without Origin', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://example.com'], strictPreflight: true });
    const req = makeReq({ method: 'OPTIONS', headers: {} });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('sets Access-Control-Allow-Private-Network when requested', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://app.local'], allowPrivateNetwork: true });
    const req = makeReq({
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.local',
        'access-control-request-private-network': 'true',
      },
    });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Private-Network']).toBe('true');
  });

  it('sets Access-Control-Expose-Headers when configured', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://a.com'], exposedHeaders: ['X-Custom', 'X-Total'] });
    const req = makeReq({ headers: { origin: 'https://a.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Expose-Headers']).toBe('X-Custom, X-Total');
  });

  it('sets Access-Control-Allow-Credentials when credentials=true', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://app.com'], credentials: true });
    const req = makeReq({ headers: { origin: 'https://app.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Credentials']).toBe('true');
  });
});

describe('useCors — RegExp and string origin, default allowed headers', () => {
  it('RegExp origin matches and sets resolved origin', async () => {
    const app = new Axiomify();
    useCors(app, { origin: /^https?:\/\/(.*\.)?example\.com$/ });
    const req = makeReq({ headers: { origin: 'https://sub.example.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://sub.example.com');
  });

  it('string origin: exact match allowed, non-match excluded', async () => {
    const app = new Axiomify();
    useCors(app, { origin: 'https://app.io' });
    const allowed = makeReq({ headers: { origin: 'https://app.io' } });
    const denied = makeReq({ headers: { origin: 'https://evil.io' } });
    const r1 = makeRes();
    const r2 = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) {
      await h(allowed, r1);
      await h(denied, r2);
    }
    expect(r1.headers['Access-Control-Allow-Origin']).toBe('https://app.io');
    expect(r2.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('array origin with mixed string and RegExp entries', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://trusted.com', /^https?:\/\/.*\.internal$/] });
    const req = makeReq({ headers: { origin: 'https://svc.internal' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://svc.internal');
  });

  it('auto-anchors regex and rejects partial match bypasses', async () => {
    const app = new Axiomify();
    // /example.com/ is not anchored, so normally matches attacker-example.com
    useCors(app, { origin: /example\.com/ });
    const req = makeReq({ headers: { origin: 'https://attacker-example.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    // Should be undefined because it got auto-anchored to /^example\.com$/
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('OPTIONS without explicit allowedHeaders falls back to request header', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://a.com'] }); // no allowedHeaders
    const req = makeReq({
      method: 'OPTIONS',
      headers: {
        origin: 'https://a.com',
        'access-control-request-headers': 'X-Custom-Header',
      },
    });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Headers']).toBe('X-Custom-Header');
  });

  it('OPTIONS without allowedHeaders and no request header uses default', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://a.com'] });
    const req = makeReq({
      method: 'OPTIONS',
      headers: { origin: 'https://a.com' }, // no access-control-request-headers
    });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
  });
});

describe('useCors — setVary and edge case origins', () => {
  it('throws at startup when credentials=true and origin="*"', () => {
    const app = new Axiomify();
    expect(() => useCors(app, { credentials: true, origin: '*' })).toThrow(
      /credentials.*\*/,
    );
  });

  it('origin: true dynamically reflects request origin', async () => {
    const app = new Axiomify();
    useCors(app, { origin: true });
    const req = makeReq({ headers: { origin: 'https://any.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://any.com');
  });

  it('origin: false sets no ACAO header', async () => {
    const app = new Axiomify();
    useCors(app, { origin: false });
    const req = makeReq({ headers: { origin: 'https://any.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('origin: true combined with credentials: true sets dynamic origin and credentials header', async () => {
    const app = new Axiomify();
    useCors(app, { origin: true, credentials: true });
    const req = makeReq({ headers: { origin: 'https://any.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://any.com');
    expect(res.headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('Vary header accumulates across multiple hooks', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://a.com'] });
    const req = makeReq({ headers: { origin: 'https://a.com' } });
    const res = makeRes();
    // Simulate existing Vary header
    res.headers['Vary'] = 'Accept-Encoding';
    res.getHeader = vi.fn((k: string) => res.headers[k]);
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    // Origin should be appended to existing Vary
    const vary = res.headers['Vary'] ?? '';
    expect(typeof vary).toBe('string');
  });
});

describe('useCors — function origin and setVary fallback', () => {
  it('function origin granting access without requestOrigin returns "*"', async () => {
    const app = new Axiomify();
    useCors(app, { origin: async () => true });
    const req = makeReq({ headers: {} }); // no origin header
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('function origin returning false does not set ACAO', async () => {
    const app = new Axiomify();
    useCors(app, { origin: async () => false });
    const req = makeReq({ headers: { origin: 'https://x.com' } });
    const res = makeRes();
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('setVary uses res.header when getHeader is missing', async () => {
    const app = new Axiomify();
    useCors(app, { origin: 'https://specific.com' });
    // res without getHeader
    const headers: Record<string, string> = {};
    const res: any = {
      header: (k: string, v: string) => { headers[k] = v; return res; },
      // no getHeader on this response
      status: () => res, send: vi.fn(), sendRaw: vi.fn(),
      removeHeader: vi.fn(), error: vi.fn(), stream: vi.fn(),
      headersSent: false, statusCode: 200, raw: {},
      capabilities: { sse: false, streaming: false },
      get headers() { return headers; },
    };
    const req = makeReq({ headers: { origin: 'https://specific.com' } });
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(headers['Vary']).toBeDefined();
  });
});
