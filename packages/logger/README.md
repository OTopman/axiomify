# @axiomify/logger

[![npm version](https://img.shields.io/npm/v/@axiomify/logger.svg)](https://npmjs.com/package/@axiomify/logger)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Structured request/response logging for Axiomify with PII field masking and configurable log levels.

## Install

```bash
npm install @axiomify/logger
```

## Quick start

```typescript
import { useLogger } from '@axiomify/logger';

useLogger(app, {
  level: 'info',
  sensitiveFields: [
    'password',
    'authorization',
    'x-api-key',
    'token',
    'cardNumber',
    'cvv',
  ],
});
```

## Options

| Option                   | Type                                                           | Default                | Description                                                                          |
| ------------------------ | -------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `level`                  | `'trace' \| 'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal'` | `'info'`               | Minimum log level. Messages below this level are suppressed.                         |
| `sensitiveFields`        | `string[]`                                                     | see below              | Field names (case-insensitive) whose values are masked. Overrides the default list.  |
| `beautify`               | `boolean`                                                      | `process.stdout.isTTY` | Colorised, human-readable output for local development. Emits JSON when off.         |
| `includeHeaders`         | `boolean`                                                      | `false`                | Include request headers in log entries. Enable only when the log pipeline is secure. |
| `includeParams`          | `boolean`                                                      | `false`                | Include request route parameters (`req.params`) in log entries.                      |
| `includeQuery`           | `boolean`                                                      | `false`                | Include request query parameters (`req.query`) in log entries.                       |
| `includeBody`            | `boolean`                                                      | `false`                | Include request body (`req.body`) in log entries.                                    |
| `includeResponseHeaders` | `boolean`                                                      | `false`                | Include response headers in log entries.                                             |
| `includeResponsePayload` | `boolean`                                                      | `false`                | Include response payload/data in log entries.                                        |
| `includePayload`         | `boolean`                                                      | `false`                | Alias for `includeResponsePayload`.                                                  |
| `includeState`           | `boolean`                                                      | `false`                | Include request state (`req.state`) in log entries.                                  |

## Log output

Each request produces two log entries (an incoming-request line and an outgoing-response line), plus an error line when a handler throws.

**On `onRequest`** — incoming request (message `"Incoming Request"`):

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "INFO",
  "message": "Incoming Request",
  "requestId": "abc-123",
  "method": "POST",
  "path": "/users",
  "ip": "10.0.0.1"
}
```

**On `onPostHandler`** — response sent (message `"Outgoing Response"`):

```json
{
  "timestamp": "2024-01-01T00:00:00.001Z",
  "level": "INFO",
  "message": "Outgoing Response",
  "requestId": "abc-123",
  "method": "POST",
  "path": "/users",
  "durationMs": "12.000",
  "statusCode": 201
}
```

**On `onError`** — handler threw (message `"Request Failed"`):

```json
{
  "timestamp": "2024-01-01T00:00:00.001Z",
  "level": "ERROR",
  "message": "Request Failed",
  "requestId": "abc-123",
  "method": "POST",
  "path": "/users",
  "durationMs": "3.000",
  "statusCode": 400,
  "error": { "name": "ValidationError", "message": "Validation failed" }
}
```

Error stack traces are included only when `NODE_ENV !== 'production'`.

## Masking

Two complementary layers protect sensitive data.

### Key-name masking (always on)

Values under sensitive keys are masked recursively across nested objects and arrays. Keys are matched case-insensitively on word boundaries, so `author` won't match `auth`. Values are partially masked (leading/trailing characters may remain visible), not replaced with a fixed string. Common formats found in values (emails, phone numbers, card numbers, IPs, JWTs) are also detected and masked automatically.

The default `sensitiveFields` list is:

```typescript
[
  'password',
  'token',
  'authorization',
  'credit_card',
  'ssn',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
];
```

Passing `sensitiveFields` replaces this default list.

```typescript
useLogger(app, { sensitiveFields: ['password', 'token'] });
```

### Value-shape masking (best-effort)

When request/response body, query, params, or state logging is enabled (any of `includeBody`, `includeQuery`, `includeParams`, `includeState`, `includeResponsePayload`), the logger performs an additional pass that redacts values matching obvious secret shapes even when they appear under keys not in `sensitiveFields`:

- JWTs (`eyJ...` three-segment tokens)
- `Bearer <token>` headers
- Long hex blobs (32+ hex chars, e.g. API keys / hashes)
- Long base64 / base64url blobs (40+ chars)

Matches are replaced with `••••••••`. This is best-effort defence-in-depth — it is not exhaustive and does not replace key-name masking. It stays off the hot path when no such payloads are logged.

## Development mode

```typescript
useLogger(app, {
  level: 'debug',
  beautify: true, // coloured output with readable timestamps
  includeHeaders: true,
  includeParams: true,
  includeQuery: true,
  includeBody: true,
  includeResponseHeaders: true,
  includeResponsePayload: true,
  includeState: true,
});
```

## Custom log destination

The logger writes to `process.stdout`. To redirect to a log aggregator (Datadog, Loki, etc.), pipe `stdout` at the process level:

```bash
node server.js | my-log-shipper
```

Or replace `process.stdout.write` before calling `useLogger` for programmatic control.
