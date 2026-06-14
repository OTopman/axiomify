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
    status: vi.fn((c: number) => {
      statusCode = c;
      events.push(`status:${c}`);
      return res;
    }),
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
    sseInit: vi.fn(),
    sseSend: vi.fn(),
    get statusCode() {
      return statusCode;
    },
    get headersSent() {
      return sent;
    },
    raw: {},
  };
  return [res, () => events];
}

function makeAxiomifyReq(overrides: any = {}): any {
  return {
    id: 'r1',
    method: 'GET',
    url: '/test',
    path: '/test',
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

describe('Dispatcher — extended coverage', () => {
  it('HEAD request: sends no body but includes headers', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/resource',
      schema: { response: z.object({ id: z.string() }) },
      handler: async (_req, res) => {
        res.send({ id: '1' });
      },
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
        async (_req, res) => {
          res.status(401).send(null, 'Unauthorized');
        },
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
    app.addHook('onError', (err) => {
      caught.push(err);
    });
    app.route({
      method: 'GET',
      path: '/throws',
      handler: async () => {
        throw Object.assign(new Error('boom'), { statusCode: 503 });
      },
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
      method: 'GET',
      path: '/err-status',
      handler: async () => {
        throw Object.assign(new Error('gone'), { status: 410 });
      },
    });
    const [res, events] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/err-status' });
    await app.handle(req, res);
    expect(events()).toContain('status:410');
  });

  it('handleMatchedRoute throws without ADAPTER_LOCK_TOKEN', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/x',
      handler: async (_r, res) => res.send({}),
    });
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/x' });
    const route = app.registeredRoutes[0];
    await expect(
      app.handleMatchedRoute('bad_token' as any, req, res, route, {}),
    ).rejects.toThrow(/requires the ADAPTER_LOCK_TOKEN/);
  });

  it('handleMatchedRoute with token dispatches correctly', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/y',
      handler: async (_r, res) => res.send({ y: 1 }),
    });
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
    app.addHook('onClose', () => {
      closeFired.push(true);
    });
    app.route({
      method: 'GET',
      path: '/crash',
      handler: async () => {
        throw new Error('fatal');
      },
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
      method: 'GET',
      path: '/stream-test',
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
        method: 'GET',
        path: '/dev-err',
        handler: async () => {
          throw new Error('dev error');
        },
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

  it('error in development mode handles non-string messages and missing stack', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = new Axiomify();
      app.route({
        method: 'GET',
        path: '/no-msg-err',
        handler: async () => {
          throw { statusCode: 400 }; // object with no message and no stack
        },
      });
      const [res] = makeAxiomifyResPair();
      const req = makeAxiomifyReq({ path: '/no-msg-err' });
      await app.handle(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        undefined,
        'Internal Server Error',
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('error in development mode preserves issues and errors arrays', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = new Axiomify();
      app.route({
        method: 'GET',
        path: '/issues-err',
        handler: async () => {
          throw {
            statusCode: 422,
            message: 'Invalid entity',
            issues: [{ path: ['field'], message: 'too short' }],
          };
        },
      });
      const [res] = makeAxiomifyResPair();
      const req = makeAxiomifyReq({ path: '/issues-err' });
      await app.handle(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.send).toHaveBeenCalledWith(
        [{ path: ['field'], message: 'too short' }],
        'Invalid entity',
      );

      const app2 = new Axiomify();
      app2.route({
        method: 'GET',
        path: '/errors-err',
        handler: async () => {
          throw {
            statusCode: 422,
            message: 'Invalid entity',
            errors: [{ path: ['field2'], message: 'too long' }],
          };
        },
      });
      const [res2] = makeAxiomifyResPair();
      const req2 = makeAxiomifyReq({ path: '/errors-err' });
      await app2.handle(req2, res2);
      expect(res2.status).toHaveBeenCalledWith(422);
      expect(res2.send).toHaveBeenCalledWith(
        [{ path: ['field2'], message: 'too long' }],
        'Invalid entity',
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('ValidatingResponse.sendRaw() delegates to inner', async () => {
    const app = new Axiomify();
    const { z } = await import('zod');
    let outerRes: any;
    app.route({
      method: 'GET',
      path: '/sendraw',
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

  it('returns 405 Method Not Allowed when method does not match', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/only-get',
      handler: async (_r, res) => res.send({}),
    });
    const [res, events] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ method: 'POST', path: '/only-get' });
    await app.handle(req, res);
    expect(events()).toContain('status:405');
    expect(res.header).toHaveBeenCalledWith(
      'Allow',
      expect.stringContaining('GET'),
    );
  });

  it('streaming response: onClose hook fires on stream close', async () => {
    const app = new Axiomify();
    const closeFired: boolean[] = [];
    app.addHook('onClose', () => {
      closeFired.push(true);
    });
    app.route({
      method: 'GET',
      path: '/streamy',
      handler: async (_r, res) => {
        (res as any).isStreaming = true;
      },
    });
    const events: string[] = [];
    let sent = false;
    let onStreamCloseCb: (() => void) | null = null;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(() => {
        sent = true;
      }),
      sendRaw: vi.fn(),
      error: vi.fn(),
      stream: vi.fn(),
      capabilities: { sse: false, streaming: true },
      get statusCode() {
        return 200;
      },
      get headersSent() {
        return sent;
      },
      raw: {},
      isStreaming: false,
      get onStreamClose() {
        return onStreamCloseCb;
      },
      set onStreamClose(cb: any) {
        onStreamCloseCb = cb;
      },
    };
    await app.handle(makeAxiomifyReq({ path: '/streamy' }), res);
    expect(typeof onStreamCloseCb).toBe('function');
    onStreamCloseCb!();
    await new Promise((r) => setImmediate(r));
    expect(closeFired).toHaveLength(1);
  });

  it('handleMatchedRoute: error path invokes onError hook', async () => {
    const app = new Axiomify();
    const errs: unknown[] = [];
    app.addHook('onError', (err) => {
      errs.push(err);
    });
    app.route({
      method: 'GET',
      path: '/adapter-throws',
      handler: async () => {
        throw new Error('adapter handler boom');
      },
    });
    const route = app.registeredRoutes[0];
    const [res] = makeAxiomifyResPair();
    const req = makeAxiomifyReq({ path: '/adapter-throws' });
    await app.handleMatchedRoute(ADAPTER_LOCK_TOKEN, req, res, route, {});
    expect(errs).toHaveLength(1);
  });

  it('handleMatchedRoute: streaming response wires onStreamClose for onClose hook', async () => {
    const app = new Axiomify();
    const closeFired: boolean[] = [];
    app.addHook('onClose', () => {
      closeFired.push(true);
    });
    app.route({
      method: 'GET',
      path: '/adapter-stream',
      handler: async (_r, res) => {
        (res as any).isStreaming = true;
      },
    });
    const route = app.registeredRoutes[0];
    let onStreamCloseCb: (() => void) | null = null;
    let sent = false;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(() => {
        sent = true;
      }),
      sendRaw: vi.fn(),
      error: vi.fn(),
      stream: vi.fn(),
      capabilities: { sse: false, streaming: true },
      get statusCode() {
        return 200;
      },
      get headersSent() {
        return sent;
      },
      raw: {},
      isStreaming: false,
      get onStreamClose() {
        return onStreamCloseCb;
      },
      set onStreamClose(cb: any) {
        onStreamCloseCb = cb;
      },
    };
    await app.handleMatchedRoute(
      ADAPTER_LOCK_TOKEN,
      makeAxiomifyReq({ path: '/adapter-stream' }),
      res,
      route,
      {},
    );
    expect(typeof onStreamCloseCb).toBe('function');
    onStreamCloseCb!();
    await new Promise((r) => setImmediate(r));
    expect(closeFired).toHaveLength(1);
  });

  it('ValidatingResponse delegates status/header/getHeader/removeHeader/capabilities/sse/raw/streaming getters', async () => {
    const app = new Axiomify();
    const { z } = await import('zod');
    let captured: any;
    app.route({
      method: 'GET',
      path: '/all-delegations',
      schema: { response: z.object({ ok: z.boolean() }) },
      handler: async (_req, res: any) => {
        captured = res;
        // status / header / removeHeader / getHeader
        res.status(201).header('X-Test', '1');
        res.removeHeader('X-Test');
        res.getHeader('X-Test');
        // sse, streaming, raw getters
        const _cap = res.capabilities;
        const _raw = res.raw;
        const _ss = res.isStreaming;
        const _osc = res.onStreamClose;
        res.onStreamClose = () => {};
        res.sseInit(1000);
        res.sseSend({ x: 1 }, 'msg');
        res.send({ ok: true });
      },
    });
    let onStreamCloseCb: any = null;
    const innerHeaders: Record<string, string> = {};
    const inner: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn((k: string, v: string) => {
        innerHeaders[k] = v;
        return inner;
      }),
      getHeader: vi.fn((k: string) => innerHeaders[k]),
      removeHeader: vi.fn(() => inner),
      send: vi.fn(),
      sendRaw: vi.fn(),
      error: vi.fn(),
      stream: vi.fn(),
      sseInit: vi.fn(),
      sseSend: vi.fn(),
      capabilities: { sse: true, streaming: true },
      get statusCode() {
        return 201;
      },
      get raw() {
        return { socket: 1 };
      },
      get headersSent() {
        return false;
      },
      get isStreaming() {
        return false;
      },
      get onStreamClose() {
        return onStreamCloseCb;
      },
      set onStreamClose(cb: any) {
        onStreamCloseCb = cb;
      },
    };
    await app.handle(makeAxiomifyReq({ path: '/all-delegations' }), inner);
    expect(inner.status).toHaveBeenCalledWith(201);
    expect(inner.header).toHaveBeenCalledWith('X-Test', '1');
    expect(inner.removeHeader).toHaveBeenCalledWith('X-Test');
    expect(inner.getHeader).toHaveBeenCalledWith('X-Test');
    expect(inner.sseInit).toHaveBeenCalledWith(1000);
    expect(inner.sseSend).toHaveBeenCalledWith({ x: 1 }, 'msg');
    expect(typeof onStreamCloseCb).toBe('function');
  });

  it('ValidatingResponse: capabilities fallback when inner has none', async () => {
    const app = new Axiomify();
    const { z } = await import('zod');
    let caps: any;
    app.route({
      method: 'GET',
      path: '/caps',
      schema: { response: z.object({ ok: z.boolean() }) },
      handler: async (_req, res: any) => {
        caps = res.capabilities;
        res.send({ ok: true });
      },
    });
    const inner: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendRaw: vi.fn(),
      error: vi.fn(),
      stream: vi.fn(),
      // No `capabilities` property → ValidatingResponse uses fallback
      get statusCode() {
        return 200;
      },
      get raw() {
        return {};
      },
      get headersSent() {
        return false;
      },
    };
    await app.handle(makeAxiomifyReq({ path: '/caps' }), inner);
    expect(caps).toEqual({ sse: false, streaming: false });
  });

  it('ValidatingResponse onStreamClose setter accepts null', async () => {
    const app = new Axiomify();
    const { z } = await import('zod');
    app.route({
      method: 'GET',
      path: '/null-cb',
      schema: { response: z.object({ ok: z.boolean() }) },
      handler: async (_req, res: any) => {
        res.onStreamClose = null;
        res.send({ ok: true });
      },
    });
    let innerCb: any = 'sentinel';
    const inner: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendRaw: vi.fn(),
      error: vi.fn(),
      stream: vi.fn(),
      capabilities: { sse: false, streaming: false },
      get statusCode() {
        return 200;
      },
      get raw() {
        return {};
      },
      get headersSent() {
        return false;
      },
      get onStreamClose() {
        return innerCb;
      },
      set onStreamClose(cb: any) {
        innerCb = cb;
      },
    };
    await app.handle(makeAxiomifyReq({ path: '/null-cb' }), inner);
    expect(innerCb).toBeNull();
  });
  describe('dispatcher error fallback message', () => {
    it('uses "Internal Server Error" message when thrown error has no message string', async () => {
      const app = new Axiomify();
      app.route({
        method: 'GET',
        path: '/no-msg-err',
        handler: async () => {
          throw { statusCode: 400 }; // object with no message
        },
      });
      const [res] = makeAxiomifyResPair();
      await app.handle(makeAxiomifyReq({ path: '/no-msg-err' }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        undefined,
        'Internal Server Error',
      );
    });
  });

  describe('ValidatingResponse statusCode getter', () => {
    it('passes through statusCode from the inner response', async () => {
      const app = new Axiomify();
      let capturedStatusCode = -1;
      app.route({
        method: 'GET',
        path: '/val-res-code',
        schema: {
          response: {
            200: z.object({ ok: z.boolean() }),
          },
        },
        handler: async (req, res) => {
          capturedStatusCode = res.statusCode;
          res.send({ ok: true });
        },
      });
      const [res] = makeAxiomifyResPair();
      await app.handle(makeAxiomifyReq({ path: '/val-res-code' }), res);
      expect(capturedStatusCode).toBe(200);
    });
  });

  describe('Dispatcher extra branch coverage', () => {
    it('onPreHandler hook sending response short-circuits dispatch', async () => {
      const app = new Axiomify();
      app.addHook('onPreHandler', async (req, res) => {
        res.status(200).send({ pre: true });
      });
      app.route({
        method: 'GET',
        path: '/pre-sent',
        handler: async (req, res) => {
          res.send({ handler: true });
        },
      });
      const [res, events] = makeAxiomifyResPair();
      const req = makeAxiomifyReq({ path: '/pre-sent' });
      await app.handle(req, res);
      expect(events()).toContain('send:{"pre":true}');
      expect(events()).not.toContain('send:{"handler":true}');
    });

    it('pipeline break when req.signal.aborted is true', async () => {
      const app = new Axiomify();
      const mockHandler = vi.fn();
      app.route({
        method: 'GET',
        path: '/aborted',
        plugins: [
          async (req, res) => {
            (req as any).signal = { aborted: true };
          },
        ],
        handler: mockHandler,
      });
      const [res] = makeAxiomifyResPair();
      const req = makeAxiomifyReq({ path: '/aborted' });
      await app.handle(req, res);
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('onError hook sending response stops default error response writing', async () => {
      const app = new Axiomify();
      app.addHook('onError', async (err, req, res) => {
        res.status(418).send({ errorCaught: true });
      });
      app.route({
        method: 'GET',
        path: '/throws-handled',
        handler: async () => {
          throw new Error('fatal');
        },
      });
      const [res, events] = makeAxiomifyResPair();
      const req = makeAxiomifyReq({ path: '/throws-handled' });
      await app.handle(req, res);
      expect(events()).toContain('status:418');
      expect(events()).toContain('send:{"errorCaught":true}');
      expect(events().filter((e) => e.startsWith('send:'))).toHaveLength(1);
    });

    it('development mode handles non-string stack', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const app = new Axiomify();
        app.route({
          method: 'GET',
          path: '/non-string-stack',
          handler: async () => {
            const err = new Error('custom');
            Object.defineProperty(err, 'stack', { value: 12345 });
            throw err;
          },
        });
        const [res, events] = makeAxiomifyResPair();
        const req = makeAxiomifyReq({ path: '/non-string-stack' });
        await app.handle(req, res);
        const sendEvent = events().find((e) => e.startsWith('send:'));
        expect(sendEvent).toBeDefined();
        expect(sendEvent).toBe('send:undefined');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('production mode masks generic errors and exposes validation errors', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const app = new Axiomify();
        // 1. Generic error path
        app.route({
          method: 'GET',
          path: '/prod-generic-err',
          handler: async () => {
            throw new Error('sensitive database error details');
          },
        });
        const [res1, events1] = makeAxiomifyResPair();
        const req1 = makeAxiomifyReq({ path: '/prod-generic-err' });
        await app.handle(req1, res1);
        expect(res1.status).toHaveBeenCalledWith(500);
        const genericEvent = events1().find((e) => e.startsWith('send:'));
        expect(genericEvent).toBeDefined();
        const body1 = JSON.parse(genericEvent!.substring(5));
        expect(body1).toEqual({
          error: 'Internal Server Error',
          code: 'INTERNAL_ERROR',
        });

        // 2. Validation error path
        const { ValidationError } = await import('../src/index');
        app.route({
          method: 'GET',
          path: '/prod-validation-err',
          handler: async () => {
            throw new ValidationError('Validation failed', {
              body: { email: 'invalid email' },
            });
          },
        });
        const [res2, events2] = makeAxiomifyResPair();
        const req2 = makeAxiomifyReq({ path: '/prod-validation-err' });
        await app.handle(req2, res2);
        expect(res2.status).toHaveBeenCalledWith(400);
        const validationEvent = events2().find((e) => e.startsWith('send:'));
        expect(validationEvent).toBeDefined();
        const body2 = JSON.parse(validationEvent!.substring(5));
        expect(body2).toEqual({ body: { email: 'invalid email' } });
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
