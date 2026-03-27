import { AxiomifyRequest, RouteDefinition } from '../core/types';
import { executePipeline } from '../runtime/pipeline';

/**
 * Executes a defined Axiomify route purely in-memory.
 * Bypasses the network layer for ultra-fast unit testing.
 */
export async function testRoute<
  R extends RouteDefinition<any, any, any, any, any, any>,
>(
  route: R,
  requestParams: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  // Mock the engine-agnostic request object
  const mockReq: AxiomifyRequest = {
    method: route.method,
    url: route.path,
    path: route.path,
    params: requestParams.params || {},
    query: requestParams.query || {},
    headers: requestParams.headers || {},
    rawBody: requestParams.body || {},
    engine: 'express',
    originalRequest: {},
  };

  // Run the data through validation, plugins, and the handler
  return executePipeline(route, mockReq);
}
