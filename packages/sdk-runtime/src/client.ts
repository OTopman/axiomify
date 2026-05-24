import { ClientConfig, ClientRequest, ClientResponse, SdkError } from './types';
import { InterceptorManager } from './interceptors';
import { withRetry } from './retry';

export class BaseClient {
  private config: ClientConfig;
  public interceptors: InterceptorManager;

  constructor(config: ClientConfig) {
    this.config = config;
    this.interceptors = new InterceptorManager();
  }

  protected async request<T = unknown>(req: ClientRequest): Promise<T> {
    // 1. Run request interceptors
    let currentReq = await this.interceptors.runRequestInterceptors(req);

    // 2. Build fetch arguments
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
      for (const [k, v] of Object.entries(currentReq.headers)) headers.set(k, v);
    }

    // Auth provider
    if (this.config.authProvider) {
       const token = await this.config.authProvider.getToken();
       if (token) headers.set('Authorization', token);
    }

    const fetchOpts: RequestInit = {
      method: currentReq.method,
      headers,
    };

    if (currentReq.body !== undefined) {
      fetchOpts.body = JSON.stringify(currentReq.body);
      headers.set('Content-Type', 'application/json');
    }

    const fetchImpl = this.config.fetch || globalThis.fetch;

    // 3. Execute with retries
    const execRequest = async () => {
      let abortController: AbortController | undefined;
      let timeoutId: any;

      if (this.config.timeoutMs) {
        abortController = new AbortController();
        fetchOpts.signal = abortController.signal;
        timeoutId = setTimeout(() => abortController?.abort(), this.config.timeoutMs);
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
          request: currentReq
        };

        // 4. Run response interceptors
        res = await this.interceptors.runResponseInterceptors(res);

        if (!rawResponse.ok) {
           throw new SdkError(`API Error: ${rawResponse.status}`, rawResponse.status, res);
        }
        return res.data as T;
      } catch (err: any) {
        if (err instanceof SdkError) throw err;
        // Run error interceptors
        return await this.interceptors.runErrorInterceptors(err);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    return withRetry(execRequest, this.config.retryConfig);
  }
}
