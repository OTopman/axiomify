import { ClientConfig, ClientRequest, ClientResponse, SdkError } from './types';
import { InterceptorManager } from './interceptors';
import { withRetry } from './retry';
import { CircuitBreaker } from './circuit-breaker';
import { LruTtlCache } from './cache';
import { safeJsonStringify, isBinaryData } from './serializer';

export class BaseClient {
  protected config: ClientConfig;
  public interceptors: InterceptorManager;
  private circuitBreaker: CircuitBreaker;
  private cache: LruTtlCache<ClientResponse>;
  private inFlightRequests = new Map<string, Promise<any>>();

  constructor(config: ClientConfig) {
    this.config = config;
    this.interceptors = new InterceptorManager();
    this.circuitBreaker = new CircuitBreaker(
      config.circuitBreakerConfig as any,
    );
    this.cache = new LruTtlCache(100, config.cacheTtlMs || 60000);
  }

  protected async request<T = unknown>(req: ClientRequest): Promise<T> {
    const isGet = req.method === 'GET';
    const cacheKey = `${req.method}:${req.path}:${JSON.stringify(req.query)}`;

    // 1. Caching Check
    if (this.config.enableCache && isGet) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached.data as T;
    }

    // 2. Request Deduplication for in-flight requests
    if (isGet) {
      const inFlight = this.inFlightRequests.get(cacheKey);
      if (inFlight) return inFlight as Promise<T>;
    }

    const requestPromise = this.executeRequest<T>(req, cacheKey);

    if (isGet) {
      this.inFlightRequests.set(cacheKey, requestPromise);
    }

    try {
      const res = await requestPromise;
      return res;
    } finally {
      if (isGet) {
        this.inFlightRequests.delete(cacheKey);
      }
    }
  }

  private async executeRequest<T>(
    req: ClientRequest,
    cacheKey: string,
  ): Promise<T> {
    // 3. Circuit Breaker Wrapper
    return this.circuitBreaker.run(async () => {
      // Execute standard request
      // Run request interceptors
      const currentReq = await this.interceptors.runRequestInterceptors(req);

      // Build url
      const url = new URL(currentReq.path, this.config.baseUrl);
      if (currentReq.query) {
        for (const [key, value] of Object.entries(currentReq.query)) {
          if (value !== undefined && value !== null) {
            url.searchParams.append(key, String(value));
          }
        }
      }

      const headers = new Headers(this.config.headers);
      if (currentReq.headers) {
        for (const [k, v] of Object.entries(currentReq.headers))
          headers.set(k, v);
      }

      if (this.config.authProvider) {
        const token = await this.config.authProvider.getToken();
        if (token) headers.set('Authorization', token);
      }

      const fetchOpts: RequestInit = {
        method: currentReq.method,
        headers,
      };

      // Handle body encoding (including binary & FormData)
      if (currentReq.body !== undefined) {
        if (isBinaryData(currentReq.body)) {
          fetchOpts.body = currentReq.body as any;
          headers.set('Content-Type', 'application/octet-stream');
        } else if (
          typeof FormData !== 'undefined' &&
          currentReq.body instanceof FormData
        ) {
          fetchOpts.body = currentReq.body;
          // Fetch auto-sets Content-Type boundary for FormData
        } else {
          fetchOpts.body = safeJsonStringify(currentReq.body);
          headers.set('Content-Type', 'application/json');
        }
      }

      // Telemetry Hook: onBeforeRequest
      if (this.config.telemetry?.onBeforeRequest) {
        await this.config.telemetry.onBeforeRequest(currentReq);
      }

      const fetchImpl = this.config.fetch || globalThis.fetch;

      const execRequest = async () => {
        let abortController: AbortController | undefined;
        let timeoutId: any;

        if (this.config.timeoutMs) {
          abortController = new AbortController();
          fetchOpts.signal = abortController.signal;
          timeoutId = setTimeout(
            () => abortController?.abort(),
            this.config.timeoutMs,
          );
        }

        try {
          const rawResponse = await fetchImpl(url.toString(), fetchOpts);

          let data: any = null;
          if (rawResponse.status !== 204) {
            const contentType = rawResponse.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              data = await rawResponse.json();
            } else {
              data = await rawResponse.text();
            }
          }

          let res: ClientResponse<any> = {
            data,
            status: rawResponse.status,
            headers: rawResponse.headers,
            request: currentReq,
          };

          // Run response interceptors
          res = await this.interceptors.runResponseInterceptors(res);

          // Telemetry Hook: onAfterResponse
          if (this.config.telemetry?.onAfterResponse) {
            await this.config.telemetry.onAfterResponse(res);
          }

          if (!rawResponse.ok) {
            throw new SdkError(
              `API Error: ${rawResponse.status}`,
              rawResponse.status,
              res,
            );
          }

          // Cache caching candidate
          if (this.config.enableCache && currentReq.method === 'GET') {
            this.cache.set(cacheKey, res);
          }

          return res.data as T;
        } catch (err: any) {
          // Telemetry Hook: onError
          if (this.config.telemetry?.onError) {
            await this.config.telemetry.onError(err);
          }

          return await this.interceptors.runErrorInterceptors(err);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      };

      return withRetry(execRequest, this.config.retryConfig);
    });
  }
}
