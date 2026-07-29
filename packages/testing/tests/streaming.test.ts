import { Axiomify, type SseCapableResponse } from '@axiomify/core';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createTestClient } from '../src/index';

describe('streaming', () => {
  it('collects a streamed readable into the response body', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/file',
      handler: async (_req, res) => {
        res.stream(Readable.from(['hello ', 'stream ', 'world']), 'text/plain');
      },
    });

    const res = await createTestClient(app).get('/file');
    expect(res.body).toBe('hello stream world');
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(res.isStreaming).toBe(true);
  });

  it('defaults the stream content type to application/octet-stream', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/bin',
      handler: async (_req, res) => {
        res.stream(Readable.from([Buffer.from([0x68, 0x69])]));
      },
    });

    const res = await createTestClient(app).get('/bin');
    expect(res.body).toBe('hi');
    expect(res.headers['content-type']).toBe('application/octet-stream');
  });

  it('fires deferred onClose hooks after the stream ends', async () => {
    const app = new Axiomify();
    const onClose = vi.fn();
    app.addHook('onClose', onClose);
    app.route({
      method: 'GET',
      path: '/s',
      handler: async (_req, res) => {
        res.stream(Readable.from(['chunk']));
      },
    });

    await createTestClient(app).get('/s');
    // allow the deferred (fire-and-forget) hook microtask to run
    await new Promise((resolve) => setImmediate(resolve));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('captures stream errors and keeps chunks received so far', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/broken-stream',
      handler: async (_req, res) => {
        const readable = new Readable({
          read() {
            this.push('partial');
            this.destroy(new Error('pipe burst'));
          },
        });
        res.stream(readable);
      },
    });

    const res = await createTestClient(app).get('/broken-stream');
    expect(res.body).toBe('partial');
    expect(res.streamError?.message).toBe('pipe burst');
  });
});

describe('SSE', () => {
  it('captures sseInit headers and sseSend events', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/events',
      handler: async (_req, res) => {
        expect(res.capabilities).toEqual({ sse: true, streaming: true });
        const sse = res as SseCapableResponse;
        sse.sseInit(15000);
        sse.sseSend({ n: 1 });
        sse.sseSend('two\nlines', 'update');
        sse.sseSend(null, 'ping');
      },
    });

    const res = await createTestClient(app).get('/events');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['connection']).toBe('keep-alive');
    expect(res.sseHeartbeatMs).toBe(15000);
    expect(res.sseEvents).toEqual([
      { data: { n: 1 } },
      { data: 'two\nlines', event: 'update' },
      { data: null, event: 'ping' },
    ]);
    // raw wire framing, exactly as EventSource would receive it
    expect(res.body).toBe(
      'data: {"n":1}\n\n' +
        'event: update\ndata: two\ndata: lines\n\n' +
        'event: ping\n\n',
    );
  });

  it('auto-initialises SSE on first sseSend', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/lazy-sse',
      handler: async (_req, res) => {
        res.sseSend!({ hello: true });
      },
    });

    const res = await createTestClient(app).get('/lazy-sse');
    expect(res.sseStarted).toBe(true);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.sseEvents).toEqual([{ data: { hello: true } }]);
  });
});

describe('timeout', () => {
  it('rejects with a helpful error when the handler never responds', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/void',
      handler: async () => {
        /* never responds */
      },
    });

    await expect(
      createTestClient(app).get('/void', { timeoutMs: 25 }),
    ).rejects.toThrow(/timed out after 25ms.*GET \/void.*never produced/s);
  });

  it('rejects when the handler hangs forever', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/hang',
      handler: async () => {
        await new Promise(() => {});
      },
    });

    await expect(
      createTestClient(app, { timeoutMs: 25 }).get('/hang'),
    ).rejects.toThrow(/timed out/);
  });

  it('resolves when a handler responds asynchronously after returning', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/late',
      handler: (_req, res) => {
        setTimeout(() => res.send({ late: true }), 10);
      },
    });

    const res = await createTestClient(app).get('/late');
    expect(res.data).toEqual({ late: true });
  });
});
