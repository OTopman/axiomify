import { describe, expect, it, vi, afterEach } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useLogger } from '../src/index';

function makeReq(overrides: any = {}) {
  return {
    id: 'req_1',
    method: 'GET',
    url: '/',
    path: '/',
    ip: '127.0.0.1',
    headers: { authorization: 'Bearer secret' },
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  } as any;
}

function makeRes(overrides: any = {}) {
  return {
    statusCode: 200,
    raw: {},
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    removeHeader: vi.fn(),
    send: vi.fn(),
    sendRaw: vi.fn(),
    error: vi.fn(),
    stream: vi.fn(),
    capabilities: { sse: false, streaming: false },
    ...overrides,
  } as any;
}

async function runHooks(app: Axiomify, hookType: string, ...args: any[]) {
  for (const h of (app as any).hooks.hooks[hookType]) await h(...args);
}

describe('useLogger — extended coverage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers onRequest, onPostHandler, and onError hooks', () => {
    const app = new Axiomify();
    useLogger(app);
    const hooks = (app as any).hooks.hooks;
    expect(hooks.onRequest.length).toBeGreaterThan(0);
    expect(hooks.onPostHandler.length).toBeGreaterThan(0);
    expect(hooks.onError.length).toBeGreaterThan(0);
  });

  it('logs incoming request without throwing', async () => {
    const app = new Axiomify();
    useLogger(app, { beautify: false });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(
      runHooks(app, 'onRequest', makeReq(), makeRes()),
    ).resolves.toBeUndefined();
  });

  it('masks sensitive fields when includeHeaders is true', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => {
      lines.push(String(s));
      return true;
    });
    const app = new Axiomify();
    useLogger(app, {
      sensitiveFields: ['authorization'],
      includeHeaders: true,
      beautify: false,
    });
    await runHooks(app, 'onRequest', makeReq(), makeRes());
    expect(lines.join('')).not.toContain('Bearer secret');
  });

  it('logs outgoing response without throwing', async () => {
    const app = new Axiomify();
    useLogger(app, { beautify: false });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = makeReq();
    req.state.startTime = process.hrtime.bigint();
    await expect(
      runHooks(app, 'onPostHandler', req, makeRes({ statusCode: 201 }), {
        route: {} as any,
        params: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('logs errors without throwing', async () => {
    const app = new Axiomify();
    useLogger(app, { beautify: false });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = makeReq();
    req.state.startTime = process.hrtime.bigint();
    await expect(
      runHooks(app, 'onError', new Error('boom'), req, makeRes()),
    ).resolves.toBeUndefined();
  });

  it('pretty print uses console.log', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const app = new Axiomify();
    useLogger(app, { prettyPrint: true, beautify: true });
    await runHooks(app, 'onRequest', makeReq(), makeRes());
    expect(spy).toHaveBeenCalled();
  });

  it('handles non-Error thrown values in onError', async () => {
    const app = new Axiomify();
    useLogger(app, { beautify: false });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = makeReq();
    await expect(
      runHooks(app, 'onError', 'plain string error', req, makeRes()),
    ).resolves.toBeUndefined();
  });

  it('missing startTime in state does not crash onPostHandler', async () => {
    const app = new Axiomify();
    useLogger(app, { beautify: false });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = makeReq(); // no startTime
    await expect(
      runHooks(app, 'onPostHandler', req, makeRes(), {
        route: {} as any,
        params: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('filters out info logs when level is set to fatal', async () => {
    const app = new Axiomify();
    useLogger(app, { level: 'fatal', beautify: false });
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await runHooks(app, 'onRequest', makeReq(), makeRes());
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('outputs info logs when level is set to trace', async () => {
    const app = new Axiomify();
    useLogger(app, { level: 'trace', beautify: false });
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await runHooks(app, 'onRequest', makeReq(), makeRes());
    expect(writeSpy).toHaveBeenCalled();
  });
});
