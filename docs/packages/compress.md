# @axiomify/compress

HTTP response compression for Axiomify — brotli, gzip and deflate (plus zstd on
runtimes that support it) with q-value content negotiation, streaming support and
sensible MIME/size heuristics. Zero dependencies: built entirely on `node:zlib`.

## Install

```bash
npm install @axiomify/compress
```

## Quick start

```typescript
import { useCompress } from '@axiomify/compress';

useCompress(app);
// GET /api/users with Accept-Encoding: br → brotli-compressed JSON
```

The plugin registers an `onRequest` hook that wraps `res.send()`, `res.sendRaw()`
and `res.stream()` on the live response, so it works with any adapter and applies
to every route — including responses produced by other plugins such as
`@axiomify/static`.

## Options

| Option              | Type                 | Default                                                                                        | Description                                                                      |
| ------------------- | -------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `threshold`         | `number`             | `1024`                                                                                         | Minimum payload size (bytes) before compressing. Streams have no threshold.      |
| `encodings`         | `CompressEncoding[]` | `['br', 'gzip', 'deflate']` (+ `'zstd'` when available)                                        | Server preference order of offered encodings.                                    |
| `compressibleTypes` | `string[]`           | `['text/*', 'application/json', 'application/javascript', 'image/svg+xml', 'application/xml']` | MIME allowlist. `type/*` matches by prefix; content-type parameters are ignored. |
| `brotliOptions`     | `zlib.BrotliOptions` | `{}`                                                                                           | Forwarded to brotli (buffer path adds `BROTLI_PARAM_SIZE_HINT` automatically).   |
| `gzipOptions`       | `zlib.ZlibOptions`   | `{}`                                                                                           | Forwarded to gzip **and** deflate.                                               |

```typescript
useCompress(app, {
  threshold: 2048,
  encodings: ['br', 'gzip'], // never offer deflate
  compressibleTypes: [
    'text/*',
    'application/json',
    'application/graphql-response+json',
  ],
  brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
  gzipOptions: { level: 6 },
});
```

## Content negotiation

`Accept-Encoding` is parsed with full q-value support:

- The acceptable encoding with the **highest client q-value** wins; ties break by
  server preference order (`br > gzip > deflate`).
- `gzip;q=0` (or `*;q=0`) excludes an encoding.
- An explicit `identity` with a higher q than every offered encoding selects
  identity — the response is sent uncompressed.
- `identity;q=0, br` compresses with brotli. When _nothing_ is acceptable the
  plugin still serves identity rather than failing the request with 406.
- A missing `Accept-Encoding` header means identity.

### zstd

`zstd` is offered automatically when the running Node exposes zstd in
`node:zlib` (Node ≥ 23.8 / 24) — detected at load time, never assumed.
Explicitly listing `'zstd'` in `encodings` on an older runtime logs a warning
and drops it. `ZSTD_SUPPORTED` is exported if you need to branch on it.

## What gets compressed

A response is compressed when **all** of the following hold:

1. The negotiated encoding is not identity.
2. The MIME type is in `compressibleTypes` (`res.send()` counts as
   `application/json`). `text/event-stream` is always excluded.
3. The payload reaches `threshold` bytes (buffers only — streams always qualify).
4. None of the skip conditions below apply.

Skipped automatically:

- `Content-Encoding` already set (payload was pre-compressed upstream),
- `Cache-Control: no-transform` (RFC 9110 §5.5.2),
- `206 Partial Content` / a `Content-Range` header (byte ranges address the
  identity representation),
- `HEAD` requests (headers, including `Vary`, still mirror GET),
- non-string/Buffer `sendRaw` payloads,
- routes flagged with `disableCompression`.

### `Vary: Accept-Encoding`

Appended (never duplicated, `Vary: *` respected) on every compressible response
— **even when the client did not accept an encoding** — so shared caches key the
cache entry on the request's `Accept-Encoding`.

## Opting a route out

`disableCompression` is a `RouteMiddleware` that flags the request state:

```typescript
import { disableCompression } from '@axiomify/compress';

app.route({
  method: 'GET',
  path: '/download/archive',
  plugins: [disableCompression],
  handler: async (req, res) =>
    res.stream(fs.createReadStream(archive), 'text/csv'),
});
```

## How `res.send()` is handled

`NativeResponse.send()` serializes and stringifies internally and writes straight
to the socket — its output cannot be intercepted. The wrapper replicates the same
pipeline (`makeSerialize(app.serializer)` → `JSON.stringify`) and emits the
compressed body through the original `sendRaw(compressed, 'application/json')`,
preserving the status code. The response envelope is byte-identical to the
uncompressed path, including custom serializers set via `app.setSerializer()`.

Compression of buffers is fully async (promisified zlib — no event-loop
blocking). The wrapped `send`/`sendRaw`/`stream` latch as _sent_ synchronously,
so a double `res.send()` while compression is in flight is dropped exactly like
the underlying adapter would drop it. If compression ever fails, the identity
payload is emitted as a fallback.

## Exports

| Export               | Kind              | Description                               |
| -------------------- | ----------------- | ----------------------------------------- |
| `useCompress`        | `(app, options?)` | Register the compression hook.            |
| `disableCompression` | `RouteMiddleware` | Per-route opt-out flag.                   |
| `CompressOptions`    | type              | Plugin options.                           |
| `CompressEncoding`   | type              | `'br' \| 'gzip' \| 'deflate' \| 'zstd'`.  |
| `ZSTD_SUPPORTED`     | `boolean`         | Whether this runtime's zlib exposes zstd. |
