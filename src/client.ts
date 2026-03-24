export function createClient<T>(baseUrl: string, routeMap: any) {
  return new Proxy(
    {},
    {
      get(_, key: string) {
        return new Proxy(
          {},
          {
            get(_, subKey: string) {
              const fullKey = `${key}.${subKey}`;
              const meta = routeMap[fullKey];

              return async (payload: any = {}) => {
                let finalPath = meta.path;

                // 1. Inject path parameters (e.g., /users/:id -> /users/123)
                if (payload.params) {
                  Object.entries(payload.params).forEach(([k, v]) => {
                    finalPath = finalPath.replace(
                      `:${k}`,
                      encodeURIComponent(String(v)),
                    );
                  });
                }

                // 2. Inject query parameters (e.g., ?search=term)
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
                    // Prevent body inclusion on GET/HEAD requests
                    body:
                      meta.method !== 'GET' &&
                      meta.method !== 'HEAD' &&
                      payload.body
                        ? JSON.stringify(payload.body)
                        : undefined,
                  },
                );

                if (!response.ok)
                  throw new Error(
                    `Axiomify Request Failed: ${response.statusText}`,
                  );
                return response.json();
              };
            },
          },
        );
      },
    },
  );
}
