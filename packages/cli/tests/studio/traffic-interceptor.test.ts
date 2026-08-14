import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionData } from '../../src/studio/api/recorder';
import { instrumentTrafficProfiling } from '../../src/studio/api/traffic-interceptor';

function createHarness() {
  const hooks: Record<string, (...args: any[]) => any> = {};
  const dispatcherHooks: any = {
    hooks: {
      custom: [vi.fn(), vi.fn(async () => {})],
      safe: [
        vi.fn(() => {
          throw new Error('expected');
        }),
      ],
    },
    run: vi.fn(),
    runSafe: vi.fn(),
  };
  const app: any = {
    addHook: (name: string, hook: (...args: any[]) => any) => {
      hooks[name] = hook;
    },
    dispatcher: { hooks: dispatcherHooks },
    registeredRoutes: [],
    _services: new Map(),
  };
  instrumentTrafficProfiling(app);
  return { hooks, dispatcherHooks };
}

function createResponse() {
  return {
    status: vi.fn(function (this: any) {
      return this;
    }),
    header: vi.fn(function (this: any) {
      return this;
    }),
    send: vi.fn(),
    sendRaw: vi.fn(),
    stream: vi.fn((stream: Readable) => stream.resume()),
    sseInit: vi.fn(),
    sseSend: vi.fn(),
  };
}

describe('Studio traffic interceptor', () => {
  beforeEach(() => {
    const session = getSessionData();
    session.entries.length = 0;
    session.queries.length = 0;
  });

  it('captures response metadata, SSE events, and hook timings', async () => {
    const { hooks, dispatcherHooks } = createHarness();
    const req: any = {
      id: 'traffic-1',
      method: 'post',
      path: '/orders',
      headers: { accept: 'application/json' },
      query: { page: 1n },
      body: { value: 1n },
    };
    const res: any = createResponse();

    hooks.onRequest(req, res);
    res.status(201);
    res.header('X-Test', 'yes');
    res.sendRaw('raw response', 'text/plain');
    res.sseInit();
    res.sseSend({ ready: true }, 'status');
    await dispatcherHooks.run('custom', req, res);
    await dispatcherHooks.runSafe('safe', req, res);
    hooks.onPostHandler(req, res);

    const entry = getSessionData().entries.find(
      (item) => item.requestId === 'traffic-1',
    );
    expect(entry?.response).toMatchObject({ status: 201 });
    expect(entry?.response?.headers).toMatchObject({
      'x-test': 'yes',
      'content-type': 'text/event-stream',
    });
    expect(entry?.response?.sseEvents).toEqual([
      { data: { ready: true }, event: 'status' },
    ]);
    expect(req._profile.timeline).toHaveLength(3);
  });

  it('captures streamed responses and ignores Studio-internal traffic', async () => {
    const { hooks } = createHarness();
    const internal: any = { path: '/__studio/api/health' };
    hooks.onRequest(internal, createResponse());
    expect(internal.__perfStart).toBeUndefined();

    const req: any = {
      id: 'traffic-stream',
      method: 'GET',
      url: 'http://localhost/download',
      headers: {},
      query: {},
      body: null,
    };
    const res: any = createResponse();
    hooks.onRequest(req, res);
    res.stream(Readable.from(['hello ', 'world']), 'text/plain');
    hooks.onPostHandler(req, res);
    await req._capturedResponse.getStreamCompletion();
    await new Promise((resolve) => setImmediate(resolve));

    expect(
      getSessionData().entries.find(
        (item) => item.requestId === 'traffic-stream',
      )?.response,
    ).toMatchObject({
      body: 'hello world',
      headers: {
        'content-type': 'text/plain',
        'transfer-encoding': 'chunked',
      },
    });
  });
});
