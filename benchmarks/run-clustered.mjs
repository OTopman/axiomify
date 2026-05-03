/**
 * Axiomify Clustered Benchmark Suite
 * ────────────────────────────────────
 * Tests single-process and multi-worker configurations side by side.
 * Because this machine has 1 CPU core, multi-worker on 1 core shows
 * context-switching overhead — the projection column shows what
 * the same code achieves on an N-core production server.
 *
 * Usage:  node benchmarks/run-clustered.mjs
 */

import autocannon from 'autocannon';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVERS_DIR = join(__dirname, 'servers');

const BENCH_DURATION  = 12; // seconds
const WARMUP_DURATION = 3;
const CONNECTIONS     = 100;
const PIPELINING      = 10;

// CPU count on this machine
const { cpus } = await import('os');
const CPU_COUNT = cpus().length;

// ─── Server definitions ───────────────────────────────────────────────────────

const SERVERS = [
  // Single-worker baselines (established)
  {
    id: 'native-1w',
    label: 'Native (uWS)    — 1 worker',
    file: 'axiomify-native.mjs',
    port: 3200,
    workers: 1,
    url: 'http://localhost:3200/ping',
  },
  // Multi-worker: 2 workers
  {
    id: 'native-2w',
    label: 'Native (uWS)    — 2 workers',
    file: 'axiomify-native-clustered.mjs',
    port: 3201,
    workers: 2,
    url: 'http://localhost:3201/ping',
  },
  // Multi-worker: 4 workers (demonstrates projection for 4-core machines)
  {
    id: 'native-4w',
    label: 'Native (uWS)    — 4 workers',
    file: 'axiomify-native-clustered.mjs',
    port: 3202,
    workers: 4,
    url: 'http://localhost:3202/ping',
  },
  // Fastify adapter — single vs multi
  {
    id: 'fastify-1w',
    label: 'Fastify adapter — 1 worker',
    file: 'axiomify-fastify.mjs',
    port: 3210,
    workers: 1,
    url: 'http://localhost:3210/ping',
  },
  {
    id: 'fastify-2w',
    label: 'Fastify adapter — 2 workers',
    file: 'axiomify-fastify-clustered.mjs',
    port: 3211,
    workers: 2,
    url: 'http://localhost:3211/ping',
  },
  {
    id: 'fastify-4w',
    label: 'Fastify adapter — 4 workers',
    file: 'axiomify-fastify-clustered.mjs',
    port: 3212,
    workers: 4,
    url: 'http://localhost:3212/ping',
  },
  // HTTP adapter — single vs multi
  {
    id: 'http-1w',
    label: 'HTTP adapter    — 1 worker',
    file: 'axiomify-http.mjs',
    port: 3220,
    workers: 1,
    url: 'http://localhost:3220/ping',
  },
  {
    id: 'http-2w',
    label: 'HTTP adapter    — 2 workers',
    file: 'axiomify-http-clustered.mjs',
    port: 3221,
    workers: 2,
    url: 'http://localhost:3221/ping',
  },
  {
    id: 'http-4w',
    label: 'HTTP adapter    — 4 workers',
    file: 'axiomify-http-clustered.mjs',
    port: 3222,
    workers: 4,
    url: 'http://localhost:3222/ping',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function startServer(def) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      WORKERS: String(def.workers),
    };
    const child = spawn(process.execPath, [join(SERVERS_DIR, def.file), String(def.port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) { child.kill('SIGKILL'); reject(new Error(`${def.id} timeout`)); }
    }, 15_000);

    child.stdout.on('data', buf => {
      if (buf.toString().includes('READY') && !ready) {
        ready = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on('data', buf => {
      const msg = buf.toString().trim();
      if (msg && !msg.includes('ExperimentalWarning')) {
        process.stderr.write(`  [${def.id}] ${msg}\n`);
      }
    });

    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code, signal) => {
      if (!ready) { clearTimeout(timeout); reject(new Error(`${def.id} exited early code=${code} signal=${signal}`)); }
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

async function warmup(url) {
  await autocannon({ url, method: 'GET', duration: WARMUP_DURATION, connections: 20, pipelining: 5, silent: true });
}

async function bench(def) {
  return new Promise((resolve, reject) => {
    const inst = autocannon(
      { url: def.url, method: 'GET', duration: BENCH_DURATION, connections: CONNECTIONS, pipelining: PIPELINING, silent: true },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    process.stdout.write('  ');
    inst.on('tick', () => process.stdout.write('.'));
    inst.on('done', () => process.stdout.write('\n'));
  });
}

// ─── Projection math ─────────────────────────────────────────────────────────

/**
 * Projects multi-core throughput from a measured single-core baseline.
 * Accounts for ~90% linear scaling efficiency (kernel scheduling + IPC overhead).
 *
 * @param {number} singleCoreReqPerSec  Measured 1-worker req/s
 * @param {number} targetCores          e.g. 4 for a production server
 * @param {number} efficiency           Scaling efficiency 0–1 (default 0.90)
 */
function project(singleCoreReqPerSec, targetCores, efficiency = 0.90) {
  return Math.round(singleCoreReqPerSec * targetCores * efficiency);
}

function formatReqs(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\nAxiomify Clustered Benchmark — ${CPU_COUNT} CPU core(s) available`);
console.log(`Connections: ${CONNECTIONS}  Pipelining: ${PIPELINING}  Duration: ${BENCH_DURATION}s  Warmup: ${WARMUP_DURATION}s\n`);

if (CPU_COUNT === 1) {
  console.log('  ⚠  Single-core machine: multi-worker numbers will show context-switching');
  console.log('     overhead. Projection columns show expected throughput on 4-core / 8-core');
  console.log('     production servers based on the measured single-worker baseline.\n');
}

const results = [];

for (const def of SERVERS) {
  process.stdout.write(`Starting  ${def.label.padEnd(38)} port ${def.port}...`);
  let child;
  try {
    child = await startServer(def);
    process.stdout.write(' OK\n');
    await sleep(400);
  } catch (err) {
    process.stdout.write(` FAILED: ${err.message}\n`);
    results.push({ ...def, error: err.message });
    continue;
  }

  process.stdout.write(`Warmup    ${def.label.padEnd(38)}`);
  await warmup(def.url);
  process.stdout.write(' done\n');

  process.stdout.write(`Benchmark ${def.label.padEnd(38)}`);
  let result;
  try {
    result = await bench(def);
    // Preserve our `workers` count — autocannon also has a `workers` field (its own
    // worker threads, usually undefined) which would overwrite ours if spread blindly.
    results.push({ ...def, ...result, workers: def.workers });
    process.stdout.write(
      `  Req/s: ${result.requests.average.toFixed(0).padStart(7)}  ` +
      `Lat avg: ${result.latency.average.toFixed(1)}ms  ` +
      `p99: ${result.latency.p99.toFixed(0)}ms\n`
    );
  } catch (err) {
    process.stdout.write(`  ERROR: ${err.message}\n`);
    results.push({ ...def, error: err.message });
  }

  await killServer(child);
  await sleep(500);
}

// ─── Table ────────────────────────────────────────────────────────────────────

// Find the single-worker baseline for each adapter to compute projections
const singleWorkerResults = {};
for (const r of results) {
  if (r.workers === 1 && !r.error) {
    const adapter = r.id.replace('-1w', '');
    singleWorkerResults[adapter] = r.requests?.average ?? 0;
  }
}

console.log('\n' + '═'.repeat(110));
console.log(`  CLUSTERED BENCHMARK RESULTS  (Machine: ${CPU_COUNT} CPU core)`);
console.log('═'.repeat(110));
console.log(
  'Server'.padEnd(40) +
  '  Workers' +
  '    Req/s' +
  '   Avg lat' +
  '    p99  ' +
  '  Projected 4c' +
  '  Projected 8c'
);
console.log('─'.repeat(110));

let lastAdapter = '';
for (const r of results) {
  const adapterKey = r.id.replace(/-\d+w$/, '');
  if (adapterKey !== lastAdapter) {
    if (lastAdapter) console.log('─'.repeat(110));
    lastAdapter = adapterKey;
  }

  if (r.error) {
    console.log(`  ${r.label.padEnd(38)}  ${String(r.workers).padStart(7)}  ERROR: ${r.error.slice(0, 40)}`);
    continue;
  }

  const reqSec   = r.requests?.average ?? 0;
  const avgLat   = r.latency?.average?.toFixed(1) ?? '?';
  const p99      = r.latency?.p99?.toFixed(0) ?? '?';

  // Projections always based on the 1-worker baseline (not the multi-worker
  // measured on this 1-core machine, which may be slower due to thrashing)
  const adapterBase = singleWorkerResults[adapterKey] ?? reqSec;
  const proj4c = r.workers === 1 ? project(adapterBase, 4) : null;
  const proj8c = r.workers === 1 ? project(adapterBase, 8) : null;

  console.log(
    `  ${r.label.padEnd(38)}` +
    `  ${String(r.workers).padStart(7)}` +
    `  ${formatReqs(reqSec).padStart(8)}` +
    `  ${(avgLat + 'ms').padStart(9)}` +
    `  ${(p99 + 'ms').padStart(7)}` +
    (proj4c !== null ? `  ${formatReqs(proj4c).padStart(13)}` : '               ') +
    (proj8c !== null ? `  ${formatReqs(proj8c).padStart(13)}` : '')
  );
}

console.log('═'.repeat(110));
console.log('\nProjection formula: singleCore × targetCores × 0.90 (90% linear scaling efficiency)\n');

// ─── Write JSON ───────────────────────────────────────────────────────────────

const slim = results.map(r => ({
  id: r.id,
  label: r.label,
  workers: r.workers,
  error: r.error,
  reqPerSec:   r.requests?.average,
  latAvg:      r.latency?.average,
  latP99:      r.latency?.p99,
  errors:      r.errors,
  proj4cReqPerSec: r.workers === 1 && !r.error ? project(r.requests?.average ?? 0, 4) : null,
  proj8cReqPerSec: r.workers === 1 && !r.error ? project(r.requests?.average ?? 0, 8) : null,
}));

const outPath = join(__dirname, 'results-clustered.json');
writeFileSync(outPath, JSON.stringify(slim, null, 2));
console.log(`Results written to: ${outPath}\n`);
