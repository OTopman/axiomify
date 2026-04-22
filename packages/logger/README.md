# @axiomify/logger

Structured request/response logging with sensitive-data masking.

## Install

```bash
npm install @axiomify/logger maskify-ts
```

## Usage

```ts
import { useLogger } from '@axiomify/logger';

useLogger(app, {
  level: 'info',
  beautify: true,
  includeHeaders: true,
  includePayload: true,
  sensitiveFields: ['password', 'token', 'authorization'],
});
```

## Options

- `sensitiveFields?: string[]`
- `level?: 'debug' | 'info' | 'warn' | 'error'`
- `beautify?: boolean`
- `includeHeaders?: boolean`
- `includePayload?: boolean`

## Hook behavior

- `onRequest`: logs incoming request and starts timing
- `onPostHandler`: logs status + latency
- `onError`: logs normalized error details + latency
