# @axiomify/logger

Structured request and response logging.

## Install

```bash
npm install @axiomify/logger
```

## Export

- `useLogger(app, options?)`

## Options

- `sensitiveFields`
- `level` (`debug` | `info` | `warn` | `error`)
- `beautify`
- `includeHeaders`
- `includeParams`
- `includeQuery`
- `includeBody`
- `includeResponseHeaders`
- `includeResponsePayload` (or `includePayload`)
- `includeState`

## Example

```ts
useLogger(app, {
  level: 'info',
  beautify: true,
  includeHeaders: true,
  includeParams: true,
  includeQuery: true,
  includeBody: true,
  includeResponseHeaders: true,
  includeResponsePayload: true,
  includeState: true,
  sensitiveFields: ['password', 'token', 'authorization'],
});
```

## Behavior

- logs incoming requests in `onRequest`
- logs outgoing responses + latency in `onPostHandler`
- logs normalized errors in `onError`
- masks sensitive fields using a built-in zero-dep recursive function
