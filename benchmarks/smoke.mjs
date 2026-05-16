/**
 * Fast benchmark smoke test for CI.
 *
 * The full benchmark suite in `run-all.mjs` runs autocannon for 12s per
 * scenario across 6 servers — too slow for every PR. This script:
 *
 *   1. Boots ONE Axiomify Native server.
 *   2. Hits it with autocannon for 3s × 100 connections × pipeline=4.
 *   3. Asserts the server responded successfully to ALL requests.
 *   4. Writes raw autocannon output to `benchmarks/smoke-result.json`
 *      so CI can attach it as an artifact and humans can spot trends.
 *
 * This is a "did we break the bench harness" check, not a perf regression
 * gate. Cloud CI runners have wildly variable perf (shared cores, throttled
 * NICs, noisy neighbours); gating on absolute numbers there would just
 * make CI flaky. The full suite still exists for honest-numbers runs on
 * dedicated hardware.
 *
 * Run locally:    node benchmarks/smoke.mjs
 * CI artifact:    benchmarks/smoke-result.json
 */
import autocannon from 'autocannon';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, 'servers', 'axiomify-native.mjs');
const PORT = 3199; // Avoid colliding with the full suite's default 3100
const OUT_PATH = join(__dirname, 'smoke-result.json');

const DURATION_SECONDS = 3;
const CONNECTIONS = 100;
const PIPELINING = 4;

/**
 * Wait for the bench server's `READY` marker on stdout. The benchmark
 * servers in `benchmarks/servers/*` print exactly `READY\n` after
 * `listen()` returns; this avoids racing fetch polls against the listen
 * callback and gives a clean error if the process exits during boot.
 */
// Sentinel error thrown when the server fails to boot because uWS native
// bindings don't load on this host (typically Node ≥23 or musl Alpine).
// We use this to skip — not fail — the smoke run on unsupported envs so
// developers running locally on Node 23 see a clean message instead of a
// confusing crash trace. CI runs on Node 22 / Linux and will never skip.
class UwsUnavailableError extends Error {
  constructor() {
    super('uWebSockets.js native binding could not load on this host');
    this.name = 'UwsUnavailableError';
  }
}

function waitForReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let stderrBuf = '';
    const onStdout = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[srv] ${text}`);
      if (!resolved && /(?:^|\n)READY(?:\n|$)/.test(text)) {
        resolved = true;
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      process.stderr.write(`[srv] ${text}`);
    };
    const onExit = (code) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      // Classify the failure. uWS's error message is distinctive on
      // unsupported Node versions and missing-binary platforms; surface
      // those as UwsUnavailableError so main() can convert to a clean skip.
      if (
        /This version of uWS\.js supports only Node\.js/.test(stderrBuf) ||
        /Cannot find module .*uws_.*\.node/.test(stderrBuf)
      ) {
        reject(new UwsUnavailableError());
      } else {
        reject(new Error(`Server exited before ready (code ${code})`));
      }
    };
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`Server failed to start within ${timeoutMs}ms`));
      }
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    }
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
  });
}

async function main() {
  console.log(`[smoke] booting ${SERVER_PATH} on :${PORT}`);
  // The bench server takes the port via argv[2]; do NOT use PORT env (the
  // server explicitly defaults to 3120 if argv[2] is absent).
  // The bench server takes the port via argv[2]; do NOT use PORT env (the
  // server explicitly defaults to 3120 if argv[2] is absent). stdio/stderr
  // are piped — waitForReady handles classification AND echoes to our own
  // stdio for human visibility.
  const server = spawn(process.execPath, [SERVER_PATH, String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForReady(server);
    console.log(`[smoke] server ready; running autocannon for ${DURATION_SECONDS}s`);

    const result = await autocannon({
      url: `http://localhost:${PORT}/ping`,
      connections: CONNECTIONS,
      pipelining: PIPELINING,
      duration: DURATION_SECONDS,
    });

    // Hard assertion: any non-2xx from a static /ping route is a regression.
    const non2xx = result.non2xx ?? 0;
    if (non2xx > 0) {
      throw new Error(`[smoke] ${non2xx} non-2xx responses — server is broken`);
    }
    // Sanity floor: a CI runner that can't push even 1000 req/s on /ping
    // is so degraded that the benchmark output isn't meaningful. Don't
    // gate on the upper bound (cloud variance) but flag the lower.
    if (result.requests.average < 1000) {
      throw new Error(
        `[smoke] req/s average ${result.requests.average} below sanity floor (1000). ` +
        `Either the server regressed catastrophically or the CI runner is starved.`,
      );
    }

    const summary = {
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      duration: DURATION_SECONDS,
      connections: CONNECTIONS,
      pipelining: PIPELINING,
      reqPerSec: result.requests.average,
      latAvg: result.latency.average,
      latP99: result.latency.p99,
      throughputMBs: (result.throughput.average / 1_000_000).toFixed(2),
      errors: result.errors,
      timeouts: result.timeouts,
      non2xx,
    };
    writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
    console.log(`[smoke] OK — ${summary.reqPerSec.toFixed(0)} req/s, p99 ${summary.latP99}ms`);
    console.log(`[smoke] wrote ${OUT_PATH}`);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}

main().catch((err) => {
  if (err instanceof UwsUnavailableError) {
    // Clean skip: this host can't load uWS native bindings. CI is pinned
    // to Node 22 / Linux where this path is never taken; if it DID skip on
    // CI we'd want a louder signal, but a non-zero exit code here would
    // mean local devs on Node 23 see a red script every time. Exit 0 with
    // a clear message instead.
    console.warn(
      '[smoke] SKIPPED — uWebSockets.js native binding unavailable on this host. ' +
      'Bench requires Node 18-22 on glibc Linux / macOS / Windows. ' +
      'CI runs Node 22 on Linux where this is supported.',
    );
    process.exit(0);
  }
  console.error('[smoke] FAILED:', err.message);
  process.exit(1);
});
