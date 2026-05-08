# @axiomify/logger

Structured request and response logging.

## Install

```bash
npm install @axiomify/logger maskify-ts
```

## Export

- `useLogger(app, options?)`

## Options

- `sensitiveFields`
- `level` (`debug` | `info` | `warn` | `error`)
- `beautify`
- `includeHeaders`
- `includePayload`

## Example

```ts
useLogger(app, {
  level: 'info',
  beautify: true,
  includeHeaders: true,
  includePayload: false,
  sensitiveFields: ['password', 'token', 'authorization'],
});
```

## Behavior

- logs incoming requests in `onRequest`
- logs outgoing responses + latency in `onPostHandler`
- logs normalized errors in `onError`
- masks sensitive fields using `maskify-ts`
