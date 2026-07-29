# @axiomify/compress

[![npm version](https://img.shields.io/npm/v/@axiomify/compress.svg)](https://npmjs.com/package/@axiomify/compress)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

HTTP response compression for Axiomify — brotli, gzip and deflate (plus zstd on runtimes that support it) with q-value content negotiation, streaming support and sensible MIME/size heuristics. Zero dependencies: built entirely on `node:zlib`.

## Install

```bash
npm install @axiomify/compress
```

## Quick start

```typescript
import { useCompress } from '@axiomify/compress';

useCompress(app, {
  threshold: 1024, // skip payloads smaller than 1 KiB
});
```

Every response produced through `res.send()`, `res.sendRaw()` and `res.stream()` is now compressed when the client accepts it.

## Options

| Option              | Type                 | Default                                                                                | Description                                                                                    |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `threshold`         | `number`             | `1024`                                                                                  | Minimum payload size in bytes before compression kicks in. Does not apply to streams.          |
| `encodings`         | `CompressEncoding[]` | `['br', 'gzip', 'deflate']` (+ `'zstd'` when available)                                 | Server preference order of offered encodings.                                                  |
| `compressibleTypes` | `string[]`           | `['text/*', 'application/json', 'application/javascript', 'image/svg+xml', 'application/xml']` | MIME allowlist. `type/*` entries match by prefix; parameters (`; charset=…`) are ignored.      |
| `brotliOptions`     | `zlib.BrotliOptions` | `{}` (+ automatic `BROTLI_PARAM_SIZE_HINT` for buffers)                                 | Forwarded to zlib's brotli compressor.                                                         |
| `gzipOptions`       | `zlib.ZlibOptions`   | `{}`                                                                                    | Forwarded to zlib's gzip **and** deflate compressors.                                          |

## Opting a route out

```typescript
import { disableCompression } from '@axiomify/compress';

app.route({
  method: 'GET',
  path: '/export.csv.gz', // already compressed on disk
  plugins: [disableCompression],
  handler: async (req, res) => { ... },
});
```

## Behavior

- **Negotiation:** the encoding with the highest client q-value wins; ties break by server preference (`br > gzip > deflate`). `q=0` excludes a token (including via `*;q=0`), and an explicit `identity` with a higher q than every offered encoding disables compression for that request. Requests without an `Accept-Encoding` header are served identity.
- **zstd:** offered automatically only when the running Node's `node:zlib` exposes zstd (Node ≥ 23.8). Explicitly requesting `'zstd'` in `encodings` on an older runtime drops it with a warning instead of failing.
- **Vary:** `Vary: Accept-Encoding` is appended (never duplicated) on every compressible response — even when the client did not accept an encoding — so shared caches never serve a compressed body to a client that cannot decode it.
- **Skipped automatically:** responses with a pre-set `Content-Encoding`, `Cache-Control: no-transform`, `206`/`Content-Range` partial responses, `text/event-stream`, MIME types outside the allowlist, non-string/Buffer `sendRaw` payloads, and `HEAD` requests (headers still mirror GET, including `Vary`).
- **Streams:** `res.stream()` bodies are piped through the matching zlib transform; `Content-Encoding` is set before headers flush and any stale `Content-Length` is removed. No size threshold applies since the total size is unknown.
- **Double-send safety:** the wrapped `send`/`sendRaw`/`stream` latch as *sent* synchronously; a second send issued while compression is still in flight is dropped, matching adapter semantics.
- **Failure fallback:** if buffer compression ever fails, the identity payload is emitted with the original status code instead of erroring the response.
