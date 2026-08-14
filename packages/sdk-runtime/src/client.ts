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
    // Resolve every request before looking in the cache. Cache entries must
    // never cross an authorization, tenant, locale, or other header boundary.
    const currentReq = await this.interceptors.runRequestInterceptors(req);
    const headers = await this.createHeaders(currentReq);
    const isGet = currentReq.method === 'GET';
    const cacheKey = this.createCacheKey(currentReq, headers);

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

    const requestPromise = this.executeRequest<T>(
      currentReq,
      headers,
      cacheKey,
    );

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
    requestHeaders: Headers,
    cacheKey: string,
  ): Promise<T> {
    // 3. Circuit Breaker Wrapper
    return this.circuitBreaker.run(async () => {
      // Build url
      const url = new URL(req.path, this.config.baseUrl);
      if (req.query) {
        for (const [key, value] of Object.entries(req.query)) {
          if (value !== undefined && value !== null) {
            url.searchParams.append(key, String(value));
          }
        }
      }

      const headers = new Headers(requestHeaders);
      const fetchOpts: RequestInit = { method: req.method, headers };

      // Handle body encoding (including binary & FormData)
      if (req.body !== undefined) {
        if (isBinaryData(req.body)) {
          fetchOpts.body = req.body as any;
          headers.set('Content-Type', 'application/octet-stream');
        } else if (
          typeof FormData !== 'undefined' &&
          req.body instanceof FormData
        ) {
          fetchOpts.body = req.body;
          // Fetch auto-sets Content-Type boundary for FormData
        } else {
          fetchOpts.body = safeJsonStringify(req.body);
          headers.set('Content-Type', 'application/json');
        }
      }

      // Telemetry Hook: onBeforeRequest
      if (this.config.telemetry?.onBeforeRequest) {
        await this.config.telemetry.onBeforeRequest(req);
      }

      const fetchImpl = this.config.fetch || globalThis.fetch;

      const execRequest = async () => {
        const attemptHeaders = new Headers(headers);
        const attemptOpts: RequestInit = {
          ...fetchOpts,
          headers: attemptHeaders,
        };
        let abortController: AbortController | undefined;
        let timeoutId: any;

        if (this.config.timeoutMs) {
          abortController = new AbortController();
          attemptOpts.signal = abortController.signal;
          timeoutId = setTimeout(
            () => abortController?.abort(),
            this.config.timeoutMs,
          );
        }

        try {
          const rawResponse = await fetchImpl(url.toString(), attemptOpts);

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
            request: req,
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
          if (this.config.enableCache && req.method === 'GET') {
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

  private async createHeaders(req: ClientRequest): Promise<Headers> {
    const headers = new Headers(this.config.headers);
    if (req.headers) {
      for (const [key, value] of Object.entries(req.headers)) {
        headers.set(key, value);
      }
    }
    if (this.config.authProvider) {
      const token = await this.config.authProvider.getToken();
      if (token) headers.set('Authorization', token);
    }
    return headers;
  }

  private createCacheKey(req: ClientRequest, headers: Headers): string {
    const query = Object.entries(req.query ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const headerValues = Array.from(headers.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return JSON.stringify([req.method, req.path, query, headerValues]);
  }
}
