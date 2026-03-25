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

// 🧠 This generic casting bridges the runtime Proxy with the build-time AST map
export function createClient<Router extends Record<string, any>>(
  baseUrl: string,
  routeMap: Record<string, RouteRuntimeMeta>,
) {
  return new Proxy(
    {},
    {
      get(_, domainKey: string) {
        return new Proxy(
          {},
          {
            get(_, routeKey: string) {
              const fullKey = `${domainKey}.${routeKey}`;
              const meta = routeMap[fullKey];

              return async (
                payload: RequestPayload<unknown, unknown, unknown> = {},
              ) => {
                let finalPath = meta.path;

                if (payload.params) {
                  Object.entries(payload.params).forEach(([k, v]) => {
                    finalPath = finalPath.replace(
                      `:${k}`,
                      encodeURIComponent(String(v)),
                    );
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

                const response = await globalThis.fetch(
                  `${baseUrl}${finalPath}`,
                  {
                    method: meta.method,
                    headers: {
                      'Content-Type': 'application/json',
                      ...payload.headers,
                    },
                    body:
                      meta.method !== 'GET' &&
                      meta.method !== 'HEAD' &&
                      payload.body
                        ? JSON.stringify(payload.body)
                        : undefined,
                  },
                );

                if (!response.ok) {
                  // Safely cast the unknown JSON payload to an expected error interface
                  const errBody = (await response.json().catch(() => ({}))) as {
                    message?: string;
                    error?: string;
                  };

                  const errorMessage =
                    errBody.message || errBody.error || response.statusText;
                  throw new Error(
                    `Axiomify Error [${response.status}]: ${errorMessage}`,
                  );
                }
                return response.json();
              };
            },
          },
        );
      },
    },
  ) as unknown as {
    // This creates perfect IDE autocomplete for frontend developers
    [Domain in keyof Router]: {
      [Route in keyof Router[Domain]]: (
        payload: RequestPayload<
          Router[Domain][Route]['params'],
          Router[Domain][Route]['query'],
          Router[Domain][Route]['body']
        >,
      ) => Promise<Router[Domain][Route]['response']>;
    };
  };
}
