# @axiomify/cors

CORS handling for browser-facing Axiomify apps.

## Install

```bash
npm install @axiomify/cors
```

## Export

- `useCors(app, options?)`

## Key options

- `origin`: `boolean | string | RegExp | Array<string | RegExp> | ((origin) => boolean | Promise<boolean>)`
- `methods`: allowed HTTP methods (default includes `HEAD`)
- `allowedHeaders`, `exposedHeaders`
- `credentials`
- `maxAge`
- `preflightContinue`, `optionsSuccessStatus`
- `allowPrivateNetwork`
- `varyOnRequestHeaders`
- `strictPreflight`

## Example

```ts
import { useCors } from '@axiomify/cors';

useCors(app, {
  origin: ['https://app.example.com'],
  credentials: true,
  strictPreflight: true,
  allowPrivateNetwork: true,
  exposedHeaders: ['X-Request-Id'],
});
```

## Behavior

- handles `OPTIONS` preflight automatically
- merges `Vary` headers safely
- reflects request `access-control-request-headers` when `allowedHeaders` is omitted
- throws at startup if `credentials: true` is combined with `origin: "*"`
