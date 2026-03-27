export interface RequestPayload<P, Q, B> {
  params?: P;
  query?: Q;
  body?: B;
  headers?: Record<string, string>;
}

export interface RouteRuntimeMeta {
  method: string;
  path: string;
}

export interface AxiomifyClientConfig {
  baseUrl: string;
  fetcher?: typeof fetch; // Dependency injection for custom fetch wrappers
  interceptors?: {
    onRequest?: (
      request: RequestInit & { url: string },
    ) =>
      | Promise<RequestInit & { url: string }>
      | (RequestInit & { url: string });
    onResponse?: (response: Response) => Promise<Response> | Response;
  };
}

export function createClient<Router>(
  config: AxiomifyClientConfig,
  routeMap: Record<string, RouteRuntimeMeta>,
): Router {
  const customFetch = config.fetcher || globalThis.fetch;

  function createProxy(path: string[]): any {
    const callable = async (payload: RequestPayload<any, any, any> = {}) => {
      const fullKey = path.join('.');
      const meta = routeMap[fullKey];
      if (!meta) throw new Error(`Route not found: ${fullKey}`);

      let finalPath = meta.path;
      if (payload.params)
        Object.entries(payload.params).forEach(
          ([k, v]) =>
            (finalPath = finalPath.replace(
              `:${k}`,
              encodeURIComponent(String(v)),
            )),
        );
      if (payload.query) {
        const searchParams = new URLSearchParams();
        Object.entries(payload.query).forEach(([k, v]) => {
          if (v !== undefined && v !== null) searchParams.append(k, String(v));
        });
        const qs = searchParams.toString();
        if (qs) finalPath += `?${qs}`;
      }

      let reqConfig: RequestInit & { url: string } = {
        url: `${config.baseUrl}${finalPath}`,
        method: meta.method,
        headers: { 'Content-Type': 'application/json', ...payload.headers },
        body:
          meta.method !== 'GET' && meta.method !== 'HEAD' && payload.body
            ? JSON.stringify(payload.body)
            : undefined,
      };

      if (config.interceptors?.onRequest) {
        reqConfig = await config.interceptors.onRequest(reqConfig);
      }

      let response = await customFetch(reqConfig.url, reqConfig);

      // ✨ NEW: Execute Response Interceptor
      if (config.interceptors?.onResponse) {
        response = await config.interceptors.onResponse(response);
      }

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        throw new Error(
          `Axiomify Error [${response.status}]: ${errBody.message || response.statusText}`,
        );
      }
      return response.json();
    };

    return new Proxy(callable, {
      get(_, prop: string) {
        return createProxy([...path, prop]);
      },
    });
  }
  return createProxy([]) as unknown as Router;
}
