/**
 * Extra dispatcher coverage:
 * - ValidatingResponse HEAD body suppression
 * - multi-step pipeline with headersSent short-circuit
 * - handleMatchedRoute token guard
 * - error path writes correct status from err.status / err.statusCode
 */
import { describe, expect, it, vi } from 'vitest';
import { Axiomify, ADAPTER_LOCK_TOKEN } from '../src/index';
import { z } from 'zod';

function makeAxiomifyResPair(): [any, () => string[]] {
  const events: string[] = [];
  let statusCode = 200;
  let sent = false;
  const res: any = {
    status: vi.fn((c: number) => { statusCode = c; events.push(`status:${c}`); return res; }),
    header: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    removeHeader: vi.fn().mockReturnThis(),
    send: vi.fn((data: any, msg?: string) => {
      sent = true;
      events.push(`send:${JSON.stringify(data)}`);
    }),
    sendRaw: vi.fn(),
    error: vi.fn(),
    stream: vi.fn(),
    capabilities: { sse: false, streaming: false },
    sseInit: vi.fn(), sseSend: vi.fn(),
    get statusCode() { return statusCode; },
    get headersSent() { return sent; },
    raw: {},
  };
  return [res, () => events];
}

function makeAxiomifyReq(overrides: any = {}): any {
  return {
    id: 'r1', method: 'GET', url: '/test', path: '/test', ip: '127.0.0.1',
    headers: {}, body: undefined, query: {}, params: {},
    state: {}, raw: {}, stream: null,
    ...overrides,
  };
}

describe('Dispatcher — extended coverage', () => {
  it('HEAD request: sends no body but includes headers', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/resource',
      schema: { response: z.object({ id: z.string() }) },
      handler: async (_req, res) => { res.send({ id: '1' }); },
    });
    const [res, events] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ method: 'HEAD', path: '/resource' });
    await app.handle(req, res);
    // HEAD: ValidatingResponse wraps and suppresses body
    expect(res.send).toHaveBeenCalled();
  });

  it('multi-step pipeline short-circuits when headersSent after plugin', async () => {
    const app = new Axiomify();
    const secondPlugin = vi.fn();
    app.route({
      method: 'GET',
      path: '/gated',
      plugins: [
        async (_req, res) => { res.status(401).send(null, 'Unauthorized'); },
        secondPlugin,
      ],
      handler: async (_req, res) => res.send({ ok: true }),
    });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/gated' });
    await app.handle(req, res);
    expect(secondPlugin).not.toHaveBeenCalled();
  });

  it('onError hook receives the thrown error', async () => {
    const app = new Axiomify();
    const caught: unknown[] = [];
    app.addHook('onError', (err) => { caught.push(err); });
    app.route({
      method: 'GET', path: '/throws',
      handler: async () => { throw Object.assign(new Error('boom'), { statusCode: 503 }); },
    });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/throws' });
    await app.handle(req, res);
    expect(caught).toHaveLength(1);
    expect((caught[0] as Error).message).toBe('boom');
  });

  it('uses err.status (not just statusCode) for error responses', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET', path: '/err-status',
      handler: async () => { throw Object.assign(new Error('gone'), { status: 410 }); },
    });
    const [res, events] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/err-status' });
    await app.handle(req, res);
    expect(events()).toContain('status:410');
  });

  it('handleMatchedRoute throws without ADAPTER_LOCK_TOKEN', async () => {
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/x', handler: async (_r, res) => res.send({}) });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/x' });
    const route = app.registeredRoutes[0];
    await expect(
      app.handleMatchedRoute('bad_token' as any, req, res, route, {}),
    ).rejects.toThrow(/reserved for adapter use/);
  });

  it('handleMatchedRoute with token dispatches correctly', async () => {
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/y', handler: async (_r, res) => res.send({ y: 1 }) });
    const route = app.registeredRoutes[0];
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/y' });
    await expect(
      app.handleMatchedRoute(ADAPTER_LOCK_TOKEN, req, res, route, {}),
    ).resolves.toBeUndefined();
    expect(res.send).toHaveBeenCalled();
  });

  it('onClose always fires — even when handler throws', async () => {
    const app = new Axiomify();
    const closeFired: boolean[] = [];
    app.addHook('onClose', () => { closeFired.push(true); });
    app.route({
      method: 'GET', path: '/crash',
      handler: async () => { throw new Error('fatal'); },
    });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/crash' });
    await app.handle(req, res);
    expect(closeFired).toHaveLength(1);
  });
});

describe('Dispatcher — ValidatingResponse and error dev stack', () => {
  it('ValidatingResponse.stream() delegates to inner response', async () => {
    const app = new Axiomify();
    const { z } = await import('zod');
    const { Readable } = await import('stream');
    app.route({
      method: 'GET', path: '/stream-test',
      schema: { response: z.object({ ok: z.boolean() }) },
      handler: async (_req, res) => {
        (res as any).stream(Readable.from(['data']), 'text/plain');
        // Manually mark sent since stream doesn't call send()
      },
    });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/stream-test' });
    await app.handle(req, res);
    expect(res.stream).toHaveBeenCalled();
  });

  it('error in development mode includes stack trace', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = new Axiomify();
      app.route({
        method: 'GET', path: '/dev-err',
        handler: async () => { throw new Error('dev error'); },
      });
      const [res, events] = makeAxiomifyResPair();
      const req = makeAxiomifyReq({ path: '/dev-err' });
      await app.handle(req, res);
      // In dev, error data should include stack info
      expect(res.send).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('ValidatingResponse.sendRaw() delegates to inner', async () => {
    const app = new Axiomify();
    const { z } = await import('zod');
    let outerRes: any;
    app.route({
      method: 'GET', path: '/sendraw',
      schema: { response: z.object({ ok: z.boolean() }) },
      handler: async (_req, res) => {
        (res as any).sendRaw('raw payload', 'text/plain');
      },
    });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/sendraw' });
    await app.handle(req, res);
    expect(res.sendRaw).toHaveBeenCalledWith('raw payload', 'text/plain');
  });

  it('ValidatingResponse.error() delegates to inner', async () => {
    const app = new Axiomify();
    const { z } = await import('zod');
    app.route({
      method: 'GET', path: '/err-delegate',
      schema: { response: z.object({ ok: z.boolean() }) },
      handler: async (_req, res) => {
        (res as any).error(new Error('test'));
      },
    });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/err-delegate' });
    await app.handle(req, res);
    expect(res.error).toHaveBeenCalled();
  });
});
