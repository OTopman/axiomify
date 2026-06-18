/**
 * Studio API — application metrics endpoint.
 *
 * Serves live Prometheus metrics collected by @axiomify/metrics.
 * `GET /__studio/api/metrics`
 */
import type { Axiomify } from '@axiomify/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';
import { logCorrelationStorage } from './logs';

export async function handleGetAppMetrics(
  _req: IncomingMessage,
  res: ServerResponse,
  app: Axiomify,
): Promise<void> {
  if (!app) {
    sendJson(res, { available: false, error: 'App not loaded' }, 503);
    return;
  }

  // Resolve metrics path, fallback to /metrics
  let metricsPath = '/metrics';
  if (Array.isArray(app.registeredRoutes)) {
    const found = app.registeredRoutes.find(
      (r) =>
        r.method === 'GET' &&
        (r.path === '/metrics' || r.path.endsWith('/metrics')),
    );
    if (found) {
      metricsPath = found.path;
    }
  }

  // Try fetching metrics from the running application (dev server) first
  try {
    const { getAppBaseUrl } = require('./ws-tester');
    const baseUrl = getAppBaseUrl();
    if (baseUrl) {
      const response = await fetch(`${baseUrl}${metricsPath}`, {
        // Use AbortSignal.timeout if supported, otherwise normal signal
        signal: (AbortSignal as any).timeout
          ? (AbortSignal as any).timeout(800)
          : undefined,
      });
      if (response.ok) {
        const rawText = await response.text();
        sendJson(res, {
          available: true,
          raw: rawText,
          contentType:
            response.headers.get('content-type') || 'text/plain; version=0.0.4',
          path: metricsPath,
        });
        return;
      }
    }
  } catch {
    // Fail silently and fall back to in-memory mock request execution
  }

  // Create a mock request/response to dispatch in-memory against the application
  interface MockRequest {
    id: string;
    method: string;
    url: string;
    path: string;
    headers: Record<string, string>;
    body: Record<string, never>;
    query: Record<string, never>;
    params: Record<string, never>;
    state: Record<string, never>;
    raw: Record<string, never>;
  }

  const mockReq: MockRequest = {
    id: `studio-metrics-${Date.now()}`,
    method: 'GET',
    url: metricsPath,
    path: metricsPath,
    headers: {},
    body: {},
    query: {},
    params: {},
    state: {},
    raw: {},
  };

  let responseStatus = 200;
  let responseBody = '';
  let contentType = 'text/plain';

  const responseHeaders: Record<string, string> = {};

  interface MockResponse {
    status(code: number): MockResponse;
    sendRaw(data: unknown, type?: string): void;
    send(data: unknown): void;
    header(key: string, value: string): MockResponse;
    getHeader(key: string): string | undefined;
    removeHeader(key: string): MockResponse;
    capabilities: { sse: boolean; streaming: boolean };
    readonly statusCode: number;
    readonly headersSent: boolean;
  }

  const mockRes: MockResponse = {
    status(code: number) {
      responseStatus = code;
      return this;
    },
    sendRaw(data: unknown, type?: string) {
      responseBody = String(data);
      if (type) contentType = type;
    },
    send(data: unknown) {
      responseBody = String(data);
    },
    header(key: string, value: string) {
      responseHeaders[key.toLowerCase()] = value;
      return this;
    },
    getHeader(key: string) {
      return responseHeaders[key.toLowerCase()];
    },
    removeHeader(key: string) {
      delete responseHeaders[key.toLowerCase()];
      return this;
    },
    capabilities: { sse: false, streaming: false },
    get statusCode() {
      return responseStatus;
    },
    get headersSent() {
      return false;
    },
  };

  // The mock objects satisfy the duck-typed contract of app.handle at runtime
  // but not the full AxiomifyRequest/AxiomifyResponse structural types.
  // Bridge through unknown to invoke with partial mock objects.
  const indexed = app as unknown as Record<string, unknown>;
  const handleRequest = (
    indexed['handle'] as (req: unknown, res: unknown) => Promise<void>
  ).bind(app);

  try {
    await logCorrelationStorage.run(mockReq.id, () =>
      handleRequest(mockReq, mockRes),
    );

    if (responseStatus === 404) {
      sendJson(res, {
        available: false,
        message:
          'Metrics plugin is not active in the application. To enable, call useMetrics(app) from @axiomify/metrics.',
      });
      return;
    }

    sendJson(res, {
      available: true,
      raw: responseBody,
      contentType,
      path: metricsPath,
    });
  } catch (err: any) {
    sendJson(
      res,
      {
        available: false,
        error: err.message,
      },
      500,
    );
  }
}
