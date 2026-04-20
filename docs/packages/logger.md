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
- `level`

## Example

```ts
useLogger(app, {
  level: 'info',
  sensitiveFields: ['password', 'token', 'authorization'],
});
```

## Behavior

- logs incoming requests in `onRequest`
- logs outgoing responses in `onPostHandler`
- logs thrown errors in `onError`
- uses `maskify-ts` to redact sensitive fields
