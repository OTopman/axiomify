import { describe, expect, it } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { createTestClient } from '@axiomify/testing';
import { useObservability } from '../src';

describe('useObservability', () => {
  it('extracts W3C trace context and emits Server-Timing before a response commits', async () => {
    const app = new Axiomify();
    useObservability(app);
    app.route({
      method: 'GET',
      path: '/orders',
      handler: (req, res) => {
        expect(req.state.traceContext).toEqual({
          traceparent:
            '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          tracestate: 'vendor=value',
          baggage: 'tenant=acme',
        });
        const db = req.state.timings.start('db');
        db.end();
        res.send({ ok: true });
      },
    });

    const response = await createTestClient(app).inject({
      url: '/orders',
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        tracestate: 'vendor=value',
        baggage: 'tenant=acme',
      },
    });

    expect(response.headers['server-timing']).toMatch(
      /^app;dur=\d+(?:\.\d+)?, db;dur=\d+(?:\.\d+)?$/,
    );
  });

  it('rejects invalid timing metric names', async () => {
    const app = new Axiomify();
    useObservability(app);
    app.route({
      method: 'GET',
      path: '/',
      handler: (req, res) => {
        expect(() => req.state.timings.start('db timing')).toThrow(
          'Invalid Server-Timing metric',
        );
        res.send({ ok: true });
      },
    });

    await createTestClient(app).inject({ url: '/' });
  });

  it('can disable either concern independently', async () => {
    const app = new Axiomify();
    useObservability(app, { serverTiming: false, traceContext: false });
    app.route({
      method: 'GET',
      path: '/',
      handler: (req, res) => {
        expect(req.state.traceContext).toBeUndefined();
        expect(req.state.timings).toBeUndefined();
        res.send({ ok: true });
      },
    });

    const response = await createTestClient(app).inject({
      url: '/',
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    });
    expect(response.headers['server-timing']).toBeUndefined();
  });
});
