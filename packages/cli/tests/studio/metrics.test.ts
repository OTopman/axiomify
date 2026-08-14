import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { Axiomify } from '@axiomify/core';
import { handleGetAppMetrics } from '../../src/studio/api/metrics';
import { handleGetWsAnalytics } from '../../src/studio/api/ws-analytics';

function mockJsonResponse(): {
  res: ServerResponse;
  body: () => any;
  status: () => number;
} {
  let statusCode = 200;
  let rawBody = '';
  const res = {
    writeHead(code: number) {
      statusCode = code;
      return res;
    },
    end(body: string) {
      rawBody = body;
    },
  } as any;
  return {
    res,
    body: () => JSON.parse(rawBody),
    status: () => statusCode,
  };
}

function statefulMetricsApp(): Axiomify {
  const app = new Axiomify();
  app.route({
    method: 'GET',
    path: '/metrics',
    handler: async (req, res) => {
      req.state.set('metrics-request', true);
      res.sendRaw('ws_connected_clients 2\nws_messages_received_total 7\n');
    },
  });
  return app;
}

describe('Studio metrics in-memory requests', () => {
  it('provides the RequestState contract to the application metrics fallback', async () => {
    const { res, body, status } = mockJsonResponse();

    await handleGetAppMetrics({} as any, res, statefulMetricsApp());

    expect(status()).toBe(200);
    expect(body()).toMatchObject({
      available: true,
      raw: expect.stringContaining('ws_connected_clients 2'),
    });
  });

  it('provides the RequestState contract to the WebSocket analytics metrics fallback', async () => {
    const { res, body, status } = mockJsonResponse();

    await handleGetWsAnalytics({} as any, res, statefulMetricsApp());

    expect(status()).toBe(200);
    expect(body()).toMatchObject({
      activeConnections: 2,
      totalFramesReceived: 7,
    });
  });
});
