/**
 * Axiomify Full Benchmark Suite
 * ─────────────────────────────
 * Compares 11 server configurations under identical autocannon load:
 *
 *  BARE (no Axiomify):
 *    1. Node.js http.createServer
 *    2. Express 4
 *    3. Fastify 5
 *    4. Hapi 21
 *
 *  WITH Axiomify adapter:
 *    5. @axiomify/http   (Node.js native HTTP)
 *    6. @axiomify/express
 *    7. @axiomify/fastify
 *    8. @axiomify/hapi
 *
 *  Axiomify Native:
 *    9.  GET /ping              (JSON response, no body)
 *    10. POST /echo             (JSON body parse + echo)
 *    11. GET /users/:id/posts/:postId  (two named params)
 *
 * Methodology
 * ───────────
 * - Each server runs in a SEPARATE child process (no GC cross-contamination)
 * - 3-second warm-up, then 10-second measurement window
 * - 10 pipelined connections, 4 workers
 * - Servers are killed cleanly between runs
 * - Results written to benchmarks/results.json and printed as a table
 */

import autocannon from 'autocannon';
import { fork, spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVERS_DIR = join(__dirname, 'servers');

// ─── Autocannon config ────────────────────────────────────────────────────────

const WARMUP_DURATION  = 3;   // seconds
const BENCH_DURATION   = 12;  // seconds — long enough for stable percentiles
const CONNECTIONS      = 100; // concurrent connections (simulates real load)
const PIPELINING       = 10;  // HTTP/1.1 pipelining depth

// ─── Server definitions ───────────────────────────────────────────────────────

const SERVERS = [
  // ── BARE (no Axiomify) ────────────────────────────────────────────────────
  {
    id:     'bare-node-http',
    label:  'Node.js http (bare)',
    file:   'bare-node-http.mjs',
    port:   3100,
    url:    'http://localhost:3100/ping',
    method: 'GET',
  },
  {
    id:     'bare-express',
    label:  'Express 4 (bare)',
    file:   'bare-express.mjs',
    port:   3101,
    url:    'http://localhost:3101/ping',
    method: 'GET',
  },
  {
    id:     'bare-fastify',
    label:  'Fastify 5 (bare)',
    file:   'bare-fastify.mjs',
    port:   3102,
    url:    'http://localhost:3102/ping',
    method: 'GET',
  },
  {
    id:     'bare-hapi',
    label:  'Hapi 21 (bare)',
    file:   'bare-hapi.mjs',
    port:   3103,
    url:    'http://localhost:3103/ping',
    method: 'GET',
  },

  // ── WITH Axiomify adapters ────────────────────────────────────────────────
  {
    id:     'axiomify-http',
    label:  'Axiomify + @axiomify/http',
    file:   'axiomify-http.mjs',
    port:   3110,
    url:    'http://localhost:3110/ping',
    method: 'GET',
  },
  {
    id:     'axiomify-express',
    label:  'Axiomify + @axiomify/express',
    file:   'axiomify-express.mjs',
    port:   3111,
    url:    'http://localhost:3111/ping',
    method: 'GET',
  },
  {
    id:     'axiomify-fastify',
    label:  'Axiomify + @axiomify/fastify',
    file:   'axiomify-fastify.mjs',
    port:   3112,
    url:    'http://localhost:3112/ping',
    method: 'GET',
  },
  {
    id:     'axiomify-hapi',
    label:  'Axiomify + @axiomify/hapi',
    file:   'axiomify-hapi.mjs',
    port:   3113,
    url:    'http://localhost:3113/ping',
    method: 'GET',
  },

  // ── Axiomify Native (uWebSockets.js) ──────────────────────────────────────
  {
    id:     'axiomify-native-get',
    label:  'Axiomify Native (uWS) GET /ping',
    file:   'axiomify-native.mjs',
    port:   3120,
    url:    'http://localhost:3120/ping',
    method: 'GET',
  },
  {
    id:     'axiomify-native-post',
    label:  'Axiomify Native (uWS) POST /echo (JSON body)',
    file:   'axiomify-native.mjs',
    port:   3120,
    url:    'http://localhost:3120/echo',
    method: 'POST',
    body:   JSON.stringify({ key: 'benchmark-payload' }),
    headers: { 'content-type': 'application/json' },
  },
  {
    id:     'axiomify-native-params',
    label:  'Axiomify Native (uWS) GET /users/:id/posts/:postId',
    file:   'axiomify-native.mjs',
    port:   3120,
    url:    'http://localhost:3120/users/42/posts/99',
    method: 'GET',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function startServer(serverDef) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(SERVERS_DIR, serverDef.file), String(serverDef.port)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );

    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) {
        child.kill('SIGKILL');
        reject(new Error(`Server ${serverDef.id} did not signal READY within 8s`));
      }
    }, 8000);

    child.stdout.on('data', buf => {
      const msg = buf.toString();
      if (msg.includes('READY') && !ready) {
        ready = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on('data', buf => {
      const msg = buf.toString().trim();
      if (msg) process.stderr.write(`  [${serverDef.id}] ${msg}\n`);
    });

    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code, signal) => {
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`Server ${serverDef.id} exited (code=${code} signal=${signal}) before READY`));
      }
    });
  });
}

function killServer(child) {
  return new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000);
  });
}

async function warmUp(url, method, body, headers) {
  await autocannon({
    url,
    method: method || 'GET',
    body,
    headers: headers || {},
    duration: WARMUP_DURATION,
    connections: 20,
    pipelining: 5,
    silent: true,
  });
}

async function bench(serverDef) {
  const opts = {
    url:         serverDef.url,
    method:      serverDef.method || 'GET',
    duration:    BENCH_DURATION,
    connections: CONNECTIONS,
    pipelining:  PIPELINING,
    silent:      true,
  };
  if (serverDef.body)    opts.body    = serverDef.body;
  if (serverDef.headers) opts.headers = serverDef.headers;

  return new Promise((resolve, reject) => {
    const inst = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    // Print live progress dots
    process.stdout.write('  ');
    autocannon.track(inst, { renderProgressBar: false });
    inst.on('tick', () => process.stdout.write('.'));
    inst.on('done', () => process.stdout.write('\n'));
  });
}

// ─── Pretty table ─────────────────────────────────────────────────────────────

function col(s, w, right = false) {
  const str = String(s);
  return right ? str.padStart(w) : str.padEnd(w);
}

function printTable(results) {
  const COL = [46, 10, 10, 10, 10, 10];
  const HDR  = ['Server', 'Req/s', 'Avg lat', 'p99 lat', 'Errors', 'Throughput'];

  const divider = COL.map(w => '─'.repeat(w)).join('─┼─');
  const header  = HDR.map((h, i) => col(h, COL[i], i > 0)).join(' │ ');

  console.log('\n' + '═'.repeat(divider.length));
  console.log('  AXIOMIFY BENCHMARK RESULTS');
  console.log('═'.repeat(divider.length));
  console.log(header);
  console.log(divider);

  let prevGroup = null;
  for (const r of results) {
    const group = r.id.startsWith('bare') ? 'BARE'
      : r.id.startsWith('axiomify-native') ? 'NATIVE'
      : 'AXIOMIFY';

    if (group !== prevGroup) {
      if (prevGroup !== null) console.log(divider);
      console.log(`  ── ${group} ──`);
      prevGroup = group;
    }

    if (r.error) {
      console.log(col(`  ${r.label}`, COL[0]) + ' │ ' + col('ERROR', COL[1], true) + ' │ ' + r.error.slice(0, 50));
      continue;
    }

    const reqSec   = r.requests.average.toFixed(0);
    const avgLat   = r.latency.average.toFixed(2) + 'ms';
    const p99Lat   = r.latency.p99.toFixed(2) + 'ms';
    const errors   = r.errors || 0;
    const tpMbs    = ((r.throughput.average) / 1024 / 1024).toFixed(2) + ' MB/s';

    console.log(
      [
        col(`  ${r.label}`, COL[0]),
        col(reqSec,  COL[1], true),
        col(avgLat,  COL[2], true),
        col(p99Lat,  COL[3], true),
        col(errors,  COL[4], true),
        col(tpMbs,   COL[5], true),
      ].join(' │ ')
    );
  }
  console.log('═'.repeat(divider.length) + '\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const results = [];
  let lastFile = null;
  let lastChild = null;

  console.log(`\nAxiomify Benchmark Suite`);
  console.log(`Connections: ${CONNECTIONS}  Pipelining: ${PIPELINING}  Duration: ${BENCH_DURATION}s  Warmup: ${WARMUP_DURATION}s\n`);

  for (const server of SERVERS) {
    // Only start/stop a new server when the file changes (native runs 3 scenarios)
    if (server.file !== lastFile) {
      if (lastChild) {
        process.stdout.write(`Stopping ${lastFile}...\n`);
        await killServer(lastChild);
        lastChild = null;
        await sleep(400);
      }

      process.stdout.write(`Starting ${server.file} on :${server.port}...`);
      try {
        lastChild = await startServer(server);
        process.stdout.write(' OK\n');
        await sleep(300);
      } catch (err) {
        process.stdout.write(` FAILED: ${err.message}\n`);
        results.push({ ...server, error: err.message });
        lastFile = server.file;
        continue;
      }
      lastFile = server.file;
    }

    process.stdout.write(`Warming up  ${server.label}...`);
    await warmUp(server.url, server.method, server.body, server.headers);
    process.stdout.write(' done\n');

    process.stdout.write(`Benchmarking ${server.label}:`);
    try {
      const result = await bench(server);
      results.push({ ...server, ...result });
      process.stdout.write(
        `  Req/s: ${result.requests.average.toFixed(0).padStart(8)}  ` +
        `Lat avg: ${result.latency.average.toFixed(2)}ms  ` +
        `p99: ${result.latency.p99.toFixed(2)}ms\n`,
      );
    } catch (err) {
      process.stdout.write(`  ERROR: ${err.message}\n`);
      results.push({ ...server, error: err.message });
    }
  }

  if (lastChild) {
    await killServer(lastChild);
  }

  printTable(results);

  // Write machine-readable results
  const outPath = join(__dirname, 'results.json');
  const slim = results.map(r => ({
    id:          r.id,
    label:       r.label,
    method:      r.method,
    url:         r.url,
    error:       r.error,
    reqPerSec:   r.requests?.average,
    latAvg:      r.latency?.average,
    latP50:      r.latency?.p50,
    latP75:      r.latency?.p75,
    latP99:      r.latency?.p99,
    latP999:     r.latency?.p999,
    errors:      r.errors,
    timeouts:    r.timeouts,
    throughputBps: r.throughput?.average,
    duration:    r.duration,
    connections: r.connections,
  }));
  writeFileSync(outPath, JSON.stringify(slim, null, 2));
  console.log(`Results written to: ${outPath}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
