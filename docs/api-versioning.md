# API versioning and deprecation

Use path-versioned route groups for long-lived public APIs. Keep versions
running side by side until consumers have migrated, then make the old version
visible in OpenAPI, HTTP responses, and CI.

```ts
import { Axiomify, createDeprecationPlugin } from '@axiomify/core';

app.group('/v1', (v1) => {
  v1.route({
    method: 'GET',
    path: '/users',
    schema: { deprecated: true },
    plugins: [
      createDeprecationPlugin({
        deprecatedAt: '2026-01-15T00:00:00Z',
        sunset: '2026-06-01T00:00:00Z',
        successor: 'https://api.example.com/v2/users',
      }),
    ],
    handler: listV1Users,
  });
});

app.group('/v2', (v2) => {
  v2.route({ method: 'GET', path: '/users', handler: listV2Users });
});
```

`schema.deprecated` is emitted in OpenAPI. `createDeprecationPlugin()` adds
the RFC 9745 `Deprecation` header, optional RFC 8594 `Sunset` date, and a
`Link` header with `rel="successor-version"` before the response is sent.

## Compatibility gate

Commit a route surface and require a clean comparison in CI:

```bash
axiomify routes --snapshot routes-baseline.json
axiomify routes --diff routes-baseline.json --strict-response
```

That gate catches removed routes, HTTP method changes, request-contract
changes, and—when strict—response changes. Marking a route deprecated is
reported as information, so consumers get an adoption window instead of an
unexpected break.
