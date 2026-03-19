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

                // Inject path parameters (e.g., /users/:id -> /users/123)
                if (payload.params) {
                  Object.entries(payload.params).forEach(([k, v]) => {
                    finalPath = finalPath.replace(
                      `:${k}`,
                      encodeURIComponent(String(v)),
                    );
                  });
                }

                const response = await globalThis.fetch(
                  `${baseUrl}${finalPath}`,
                  {
                    method: meta.method,
                    headers: {
                      "Content-Type": "application/json",
                      ...payload.headers,
                    },
                    body:
                      meta.method !== "GET"
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
  ) as any;
}
