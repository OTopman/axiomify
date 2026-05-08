# @axiomify/logger

Structured request/response logging for Axiomify with PII field masking and configurable log levels.

## Install

```bash
npm install @axiomify/logger
```

> `maskify-ts` is no longer required as a peer dependency — masking is handled inline.

## Quick start

```typescript
import { useLogger } from '@axiomify/logger';

useLogger(app, {
  level: 'info',
  sensitiveFields: ['password', 'authorization', 'x-api-key', 'token', 'cardNumber', 'cvv'],
});
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `level` | `'debug' \| 'info' \| 'warn' \| 'error'` | `'info'` | Minimum log level. Messages below this level are suppressed. |
| `sensitiveFields` | `string[]` | `[]` | Field names (case-insensitive) to mask in headers and body. Masked as `'****'`. |
| `beautify` | `boolean` | `false` | Colorised, human-readable output for local development. JSON in production. |
| `includeHeaders` | `boolean` | `false` | Include request headers in the log entry. Enable only when the log pipeline is secure — headers often contain auth tokens. |
| `includePayload` | `boolean` | `false` | Include the response payload. Enable only when PII content is acceptable in logs. |

## Log output

Each request produces two log entries:

**On `onRequest`** — incoming request:
```json
{ "level": "info", "requestId": "abc-123", "method": "POST", "path": "/users", "ip": "10.0.0.1", "ts": "2024-01-01T00:00:00.000Z" }
```

**On `onPostHandler`** — response sent:
```json
{ "level": "info", "requestId": "abc-123", "status": 201, "latencyMs": 12, "ts": "2024-01-01T00:00:00.001Z" }
```

**On `onError`** — handler threw:
```json
{ "level": "error", "requestId": "abc-123", "error": "Validation failed", "status": 400, "latencyMs": 3 }
```

## Masking

Masking is recursive — it traverses nested objects and arrays:

```typescript
useLogger(app, { sensitiveFields: ['password', 'token'] });

// Request body { email: 'ada@example.com', password: 'secret123', nested: { token: 'xyz' } }
// Logged as:   { email: 'ada@example.com', password: '****', nested: { token: '****' } }
```

Field names are matched case-insensitively. Masking depth is bounded to prevent stack overflow on adversarially deep objects.

## Development mode

```typescript
useLogger(app, {
  level: 'debug',
  beautify: true,      // coloured output with readable timestamps
  includeHeaders: true,
  includePayload: true,
});
```

## Custom log destination

The logger writes to `process.stdout`. To redirect to a log aggregator (Datadog, Loki, etc.), pipe `stdout` at the process level:

```bash
node server.js | my-log-shipper
```

Or replace `process.stdout.write` before calling `useLogger` for programmatic control.
