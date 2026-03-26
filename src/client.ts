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

export function createClient<Router>(
  baseUrl: string,
  routeMap: Record<string, RouteRuntimeMeta>,
): Router {
  // A recursive proxy that builds the path as you chain properties
  function createProxy(path: string[]): any {
    const callable = async (payload: RequestPayload<any, any, any> = {}) => {
      const fullKey = path.join('.');
      const meta = routeMap[fullKey];

      if (!meta) {
        throw new Error(`Route not found: ${fullKey}`);
      }

      let finalPath = meta.path;

      if (payload.params) {
        Object.entries(payload.params).forEach(([k, v]) => {
          finalPath = finalPath.replace(`:${k}`, encodeURIComponent(String(v)));
        });
      }

      if (payload.query) {
        const searchParams = new URLSearchParams();
        Object.entries(payload.query).forEach(([k, v]) => {
          if (v !== undefined && v !== null) {
            searchParams.append(k, String(v));
          }
        });
        const qs = searchParams.toString();
        if (qs) finalPath += `?${qs}`;
      }

      const response = await globalThis.fetch(`${baseUrl}${finalPath}`, {
        method: meta.method,
        headers: {
          'Content-Type': 'application/json',
          ...payload.headers,
        },
        body:
          meta.method !== 'GET' && meta.method !== 'HEAD' && payload.body
            ? JSON.stringify(payload.body)
            : undefined,
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const errorMessage =
          errBody.message || errBody.error || response.statusText;
        throw new Error(`Axiomify Error [${response.status}]: ${errorMessage}`);
      }
      return response.json();
    };

    // Return a Proxy that wraps the callable function
    return new Proxy(callable, {
      get(_, prop: string) {
        return createProxy([...path, prop]);
      },
    });
  }

  // Cast the untyped recursive proxy strictly to the generated AppRouter
  return createProxy([]) as unknown as Router;
}
