/**
 * Studio API — application metrics endpoint.
 *
 * Serves live Prometheus metrics collected by @axiomify/metrics.
 * `GET /__studio/api/metrics`
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';

export async function handleGetAppMetrics(
  _req: IncomingMessage,
  res: ServerResponse,
  app: any,
): Promise<void> {
  if (!app) {
    sendJson(res, { available: false, error: 'App not loaded' }, 503);
    return;
  }

  // Resolve metrics path, fallback to /metrics
  let metricsPath = '/metrics';
  if (Array.isArray(app.registeredRoutes)) {
    const found = app.registeredRoutes.find(
      (r: any) => r.method === 'GET' && (r.path === '/metrics' || r.path.endsWith('/metrics'))
    );
    if (found) {
      metricsPath = found.path;
    }
  }

  // Create a mock request/response to dispatch in-memory against the application
  const mockReq: any = {
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
  const mockRes: any = {
    status(code: number) {
      responseStatus = code;
      return this;
    },
    sendRaw(data: any, type?: string) {
      responseBody = data;
      if (type) contentType = type;
    },
    send(data: any) {
      responseBody = data;
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

  try {
    await app.handle(mockReq, mockRes);

    if (responseStatus === 404) {
      sendJson(res, {
        available: false,
        message: 'Metrics plugin is not active in the application. To enable, call useMetrics(app) from @axiomify/metrics.',
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
    sendJson(res, {
      available: false,
      error: err.message,
    }, 500);
  }
}
