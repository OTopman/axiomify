# @axiomify/openapi

OpenAPI generation and Swagger UI serving for Axiomify routes.

## Install

```bash
npm install @axiomify/openapi @axiomify/core zod zod-to-json-schema
```

## Export

- `useOpenAPI(app, options)`

## Options

- `routePrefix`
- `info.title`
- `info.version`
- `info.description`

## Example

```ts
useOpenAPI(app, {
  routePrefix: '/docs',
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'Generated from Axiomify route schemas',
  },
});
```

## Routes Added

- `GET <routePrefix>`
- `GET <routePrefix>/openapi.json`
