# @axiomify/cors

CORS handling for browser-facing apps.

## Install

```bash
npm install @axiomify/cors
```

## Export

- `useCors(app, options?)`

## Options

- `origin`
- `methods`
- `allowedHeaders`
- `exposedHeaders`
- `credentials`
- `maxAge`

## Example

```ts
import { useCors } from '@axiomify/cors';

useCors(app, {
  origin: ['https://app.example.com'],
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
});
```

## Important Behavior

- handles `OPTIONS` preflight automatically
- sends `Vary: Origin` for non-wildcard origins
- throws at startup if `credentials: true` is combined with `origin: "*"`
