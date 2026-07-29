# @axiomify/native

uWebSockets.js adapter — highest-throughput Axiomify transport.

## Install

```bash
npm install @axiomify/native @axiomify/core zod
```

Node.js ≥ 18, < 23. uWS is a pre-compiled native binary — check the [uWebSockets.js release page](https://github.com/uNetworking/uWebSockets.js) for your platform support.

## API

- `new NativeAdapter(app, options?)` — create adapter
- `adapter.listen(callback?)` → starts listening
- `adapter.listenClustered(opts)` — fork N worker processes with SO_REUSEPORT (Linux only by default)
- `adapter.gracefulShutdown(opts?)` — wire SIGINT/SIGTERM to a drain + onShutdown sequence
- `adapter.close()` — synchronously closes the listening socket (low-level)
- `new Http2Adapter(app, options?)` — HTTP/2 adapter on `node:http2` (uWS has no h2 API) — see [HTTP/2](#http2)

## Options

| Option                | Type                      | Default                     | Description                                                        |
| --------------------- | ------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `port`                | `number`                  | `3000`                      | Listen port                                                        |
| `maxBodySize`         | `number`                  | `1048576`                   | Max request body (1 MB)                                            |
| `trustProxy`          | `boolean`                 | `false`                     | Trust `X-Forwarded-For` for `req.ip` (requires `proxyIpValidator`) |
| `proxyIpValidator`    | `(ip: string) => boolean` | `undefined`                 | Function to validate trusted proxy IPs. Protects against spoofing. |
| `workers`             | `number`                  | `os.availableParallelism()` | Worker count for `listenClustered()`                               |
| `allowUserspaceProxy` | `boolean`                 | `false`                     | See [Clustering on macOS / Windows](#clustering-on-macos--windows) |
| `logger`              | `AxiomifyLogger`          | `console`                   | Structured logger for adapter-level warnings                       |
| `ws`                  | `NativeWsOptions`         | —                           | Built-in fallback uWS WebSocket options (Legacy)                   |

> [!WARNING]
> **Proxy IP Spoofing Guard:** Enabling `trustProxy: true` without providing a `proxyIpValidator` callback triggers a console warning in development. If `strictSchema` is enabled on the app instance, constructing the adapter will throw a validation error. You must provide a validator function to verify the proxy IP (e.g., using a CIDR check).

## Usage

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify();
app.enableRequestId();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

app.route({
  method: 'POST',
  path: '/users',
  schema: { body: z.object({ name: z.string(), email: z.string().email() }) },
  handler: async (req, res) => {
    res.status(201).send({ id: 'usr_1', ...req.body });
  },
});

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => console.log('Ready on :3000'));
```

## Multi-core clustering

```typescript
const adapter = new NativeAdapter(app, { port: 3000 });

adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary: (pids) => console.log(`Primary managing ${pids.length} workers`),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} exited (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

uWS workers bind via `SO_REUSEPORT` natively. The kernel distributes connections across workers at the socket layer — zero IPC in the request hot path.

### Clustering on macOS / Windows

`SO_REUSEPORT` is a Linux-only kernel feature. On macOS and Windows, `listenClustered()` would have to fall back to a userspace L4 TCP proxy that pipes traffic from the primary process to workers. Each byte traverses Node.js twice, which largely negates the perf advantage of using uWS in the first place.

To prevent silent production regressions, `listenClustered()` **throws** on non-Linux platforms unless you explicitly opt in:

```typescript
const adapter = new NativeAdapter(app, {
  port: 3000,
  allowUserspaceProxy: true, // acknowledge the perf cliff
});
adapter.listenClustered({
  /* ... */
});
```

When the userspace proxy activates, the adapter emits a structured `logger.warn` so the degradation is visible in your log pipeline. For production, deploy on Linux or run a single process via `listen()`.

## Graceful shutdown

Wire SIGINT and SIGTERM to a drain sequence that:

1. Closes the uWS listen socket (no new connections accepted).
2. Awaits your `onShutdown` hook (close DB pools, flush logger buffers, etc.).
3. Calls `process.exit(0)`.

If the drain exceeds `timeoutMs`, the adapter force-exits with code `1`.

```typescript
const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen();

adapter.gracefulShutdown({
  onShutdown: async () => {
    await db.close();
    await logger.flush();
  },
  timeoutMs: 15_000,
});
```

`gracefulShutdown()` is safe to call before _or_ after `listen()` — it detaches the synchronous crash-guard signal handlers that `listen()` installs by default, so only one drain runs per signal.

> **Do not** call `gracefulShutdown()` from `@axiomify/core` against a `NativeAdapter`. That core helper expects a Node.js `http.Server` and will not understand uWS's listen socket. Use `adapter.gracefulShutdown()` instead.

## WebSockets

Axiomify Native fully supports Zod-validated, hook-integrated WebSockets directly via `app.ws()`:

```typescript
app.ws({
  path: '/chat',
  schema: { message: z.object({ text: z.string() }) },
  onPreHandler: async (req, res) => {
    // authenticate
  },
  message: (client, data) => {
    client.publish('room', data);
  },
});
```

## Express middleware bridge

```typescript
import { adaptMiddleware } from '@axiomify/native';
import cors from 'cors';

const corsMiddleware = adaptMiddleware(cors({ origin: 'https://example.com' }));

app.addHook('onRequest', corsMiddleware);
```

## Routing

Routes are registered directly on the uWS app via `server.get()`, `server.post()`, etc. uWS resolves the route in C++ before any JavaScript runs. Axiomify's trie router is used only for 404/405 detection.

## SSE

Axiomify Native supports Server-Sent Events natively out of the box using `res.sseInit()` and `res.sseSend()`.

```typescript
app.route({
  method: 'GET',
  path: '/sse',
  handler: (req, res) => {
    res.sseInit(15000); // optional heartbeat
    res.sseSend({ hello: 'world' }, 'greet');
  },
});
```

## HTTP/2

> [!IMPORTANT]
> **The tradeoff, up front:** uWebSockets.js exposes **no HTTP/2 API** from its JS bindings, so HTTP/2 support is a **separate adapter class built on `node:http2`** — it does not run on uWS. `NativeAdapter` (uWS) remains the HTTP/1.1 raw-throughput path; `Http2Adapter` trades that peak throughput for HTTP/2 semantics: stream multiplexing over a single connection, HPACK header compression, and mandatory-TLS deployments where clients negotiate `h2` via ALPN. If requests/second behind an L4 balancer is your metric, stay on `NativeAdapter`. If you need h2 multiplexing (many concurrent streams per client, gRPC-web-style fan-in, HOL-blocking-sensitive frontends), use `Http2Adapter`.

```typescript
import { Axiomify } from '@axiomify/core';
import { Http2Adapter } from '@axiomify/native';

const app = new Axiomify();
app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

const adapter = new Http2Adapter(app, {
  port: 443,
  tls: { keyFile: './key.pem', certFile: './cert.pem' }, // or inline: { key, cert }
});
adapter.listen((port) => console.log(`h2 ready on :${port}`));
```

### Options

| Option             | Type                      | Default     | Description                                                                    |
| ------------------ | ------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `port`             | `number`                  | `3000`      | Listen port (`0` = ephemeral, bound port passed to the `listen` callback)      |
| `tls`              | `Http2AdapterTlsOptions`  | —           | TLS material. Required unless `h2c: true`                                      |
| `h2c`              | `boolean`                 | `false`     | Opt-in cleartext HTTP/2 (`http2.createServer`) for local dev/tests             |
| `maxBodySize`      | `number`                  | `1048576`   | Max request body (1 MB); overflow → `413` and the stream is destroyed          |
| `trustProxy`       | `boolean`                 | `false`     | Trust `X-Forwarded-For` for `req.ip` (requires `proxyIpValidator`)             |
| `proxyIpValidator` | `(ip: string) => boolean` | `undefined` | Validates the socket peer address before `X-Forwarded-For` is trusted          |
| `requestTimeout`   | `number`                  | `0`         | Answer with `504` if headers are not sent within N ms (`0` disables)           |
| `closeTimeout`     | `number`                  | `10000`     | Grace period `close()` allows sessions to drain before force-destroy           |
| `logger`           | `AxiomifyLogger`-like     | `console`   | Structured logger for adapter warnings                                         |

`Http2AdapterTlsOptions`: inline `key`/`cert` (string or Buffer) **or** `keyFile`/`certFile` paths (read synchronously at construction with clear errors), plus optional `passphrase`, `alpnProtocols` (default `['h2', 'http/1.1']`), and `allowHTTP1` (default `true`).

The same `trustProxy` spoofing guard as `NativeAdapter` applies: enabling `trustProxy` without a `proxyIpValidator` logs a warning, and throws when the app has `strictSchema` enabled.

### ALPN fallback

The secure server advertises ALPN `['h2', 'http/1.1']` with `allowHTTP1: true`. Clients that cannot speak h2 (older proxies, plain `https` clients) transparently fall back to HTTP/1.1 **over the same TLS port** — one request/response implementation (the node:http2 Compat API) serves both protocols, so cookies, SSE, streaming, and validation behave identically on either.

### h2c (cleartext HTTP/2)

For local development, tests, and trusted internal meshes you can skip TLS:

```typescript
const adapter = new Http2Adapter(app, { h2c: true, port: 0 });
adapter.listen((port) => console.log(`h2c on :${port}`));
```

> [!WARNING]
> Browsers only negotiate HTTP/2 over TLS+ALPN — they will **not** connect to an h2c server. Use h2c for `node:http2` clients, service meshes that terminate TLS upstream, and test suites.

### Behavior notes

- **Pseudo-headers** (`:path`, `:method`, `:authority`, …) are stripped from `req.headers`; `:authority` is mapped to `host` when no literal Host header is present, so host-based logic works identically across h2 and the h1 fallback.
- **Full response surface**: serializer envelope on `send()`, `sendRaw()`, `res.stream()` with backpressure, SSE (`sseInit`/`sseSend`, heartbeat cleared on disconnect), `cookie()`/`clearCookie()` emitting one `Set-Cookie` line per cookie, HEAD body suppression, and `204/205/304` null-body handling.
- **Graceful shutdown**: `adapter.gracefulShutdown(opts?)` mirrors `NativeAdapter` — `close()` stops the listener and sends GOAWAY to live sessions, in-flight streams drain, then `onShutdown` runs; stragglers are force-destroyed after `closeTimeout`.
- **Connection-specific headers** (`Connection`, `Keep-Alive`, `Transfer-Encoding`, …) are dropped silently — they are illegal on HTTP/2 responses and unnecessary on the h1 fallback.

## Benchmarks (8-core machine, autocannon 100 conns, pipelining 10, 12 s)

| Scenario                                |  Req/s | Avg lat |   p99 |
| --------------------------------------- | -----: | ------: | ----: |
| GET /ping (no body, no params)          | 73,511 |   13 ms | 26 ms |
| GET /users/:id/posts/:postId (2 params) | 83,947 |   11 ms | 20 ms |
| POST /echo (JSON body parse + echo)     | 54,720 |   18 ms | 30 ms |

The param route outperforms ping because the router optimisation (caller-provided `paramsOut`) eliminates the intermediate object allocation — better cache locality than the no-param path under sustained load.
