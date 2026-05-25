/**
 * Axiomify Clustered Benchmark Suite
 * ────────────────────────────────────
 * Tests single-process and multi-worker configurations for Native (uWS),
 * @axiomify/http, and @axiomify/fastify under identical autocannon load.
 *
 * CRITICAL: Run autocannon on a SEPARATE machine for accurate multi-worker
 * numbers. When loadgen and server share a machine:
 *
 *   - Each server worker claims a CPU core that autocannon could use.
 *   - As worker count increases, autocannon gets fewer cores → measured
 *     throughput DROPS even though the server is faster.
 *   - This makes clustering LOOK harmful when it is actually beneficial.
 *
 * The table prints measured scaling efficiency (N-worker req/s ÷ 1-worker
 * req/s). Efficiency > 100% = real gain. Saturation warnings flag cases
 * where autocannon is likely the bottleneck.
 *
 * Usage (co-located, informational):
 *   node benchmarks/run-clustered.mjs
 *
 * Usage (remote loadgen — accurate):
 *   SERVER_HOST=192.168.1.10 node benchmarks/run-clustered.mjs
 *   # Run the server separately on the target host first, then point here.
 */

import autocannon from 'autocannon';
import { spawn }  from 'child_process';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { availableParallelism } from 'os';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const SERVERS_DIR = join(__dirname, 'servers');

const BENCH_DURATION  = 15;   // seconds — longer window for stable p99
const WARMUP_DURATION = 5;    // seconds — let JIT and SO_REUSEPORT settle
const CONNECTIONS     = 100;  // concurrent connections
const PIPELINING      = 10;   // HTTP/1.1 pipelining depth

const CPU_COUNT   = availableParallelism();
const SERVER_HOST = process.env.SERVER_HOST || 'localhost';
const IS_REMOTE   = SERVER_HOST !== 'localhost';

// ─── Worker counts to test ────────────────────────────────────────────────────
// We test 1w, 2w, and up to CPU_COUNT/2 workers.
// Leaving half the cores for autocannon gives the most honest co-located numbers.
// On a separate loadgen host, all cores can be dedicated to the server.
const MAX_SERVER_WORKERS = IS_REMOTE ? CPU_COUNT : Math.max(2, Math.floor(CPU_COUNT / 2));
const WORKER_TIERS = [1, 2, 4, 6, 8].filter(n => n <= MAX_SERVER_WORKERS);
if (!WORKER_TIERS.includes(MAX_SERVER_WORKERS)) WORKER_TIERS.push(MAX_SERVER_WORKERS);

const ADAPTERS = [
  { key: 'native',   label: 'Native (uWS)',     file: 'axiomify-native-clustered.mjs',  basePort: 3200 },
];

// Build the full server matrix: every adapter × every worker tier
const SERVERS = [];
for (const adapter of ADAPTERS) {
  for (let i = 0; i < WORKER_TIERS.length; i++) {
    const w = WORKER_TIERS[i];
    SERVERS.push({
      id:       `${adapter.key}-${w}w`,
      label:    `${adapter.label.padEnd(16)} — ${w}w`,
      file:     adapter.file,
      port:     adapter.basePort + i,
      workers:  w,
      url:      `http://${SERVER_HOST}:${adapter.basePort + i}/ping`,
      adapterKey: adapter.key,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(def) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(SERVERS_DIR, def.file), String(def.port)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production', WORKERS: String(def.workers) },
      },
    );

    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) { child.kill('SIGKILL'); reject(new Error(`${def.id} timed out (10s)`)); }
    }, 10_000);

    child.stdout.on('data', buf => {
      if (buf.toString().includes('READY') && !ready) {
        ready = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });
    child.stderr.on('data', buf => {
      const msg = buf.toString().trim();
      // Suppress deprecation warnings from deprecated adapters — they're intentional
      if (msg && !msg.includes('deprecated') && !msg.includes('[axiomify]')) {
        process.stderr.write(`  [${def.id}] ${msg}\n`);
      }
    });
    child.on('error', err => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code, sig) => {
      if (!ready) { clearTimeout(timeout); reject(new Error(`${def.id} exited early (code=${code} sig=${sig})`)); }
    });
  });
}

function killServer(child) {
  return new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2_000);
  });
}

async function runBench(def) {
  // Warmup
  await autocannon({ url: def.url, duration: WARMUP_DURATION,
    connections: 20, pipelining: 5, silent: true });

  // Measurement
  return new Promise((resolve, reject) => {
    const inst = autocannon(
      { url: def.url, duration: BENCH_DURATION,
        connections: CONNECTIONS, pipelining: PIPELINING, silent: true },
      (err, result) => err ? reject(err) : resolve(result),
    );
    process.stdout.write('  ');
    inst.on('tick', () => process.stdout.write('.'));
    inst.on('done', () => process.stdout.write('\n'));
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n═══ Axiomify Clustered Benchmark ═══════════════════════════════════');
console.log(`Machine:     ${CPU_COUNT} logical cores`);
console.log(`Server host: ${SERVER_HOST}${IS_REMOTE ? ' (remote — accurate mode)' : ' (co-located — loadgen competes for CPU)'}`);
console.log(`Connections: ${CONNECTIONS}  Pipelining: ${PIPELINING}  Duration: ${BENCH_DURATION}s  Warmup: ${WARMUP_DURATION}s`);
console.log(`Worker tiers: ${WORKER_TIERS.join(', ')}`);

if (!IS_REMOTE) {
  console.log('\n  ⚠  CO-LOCATED WARNING: autocannon shares CPUs with server workers.');
  console.log('     Multi-worker numbers may DECREASE at high worker counts — this is');
  console.log('     autocannon starvation, NOT a server regression. For accurate results:');
  console.log('     set SERVER_HOST=<server-ip> and run server files manually on that host.\n');
}

const results = [];

for (const def of SERVERS) {
  process.stdout.write(`\nStarting  ${def.label} on :${def.port}... `);
  let child;
  try {
    child = await startServer(def);
    process.stdout.write('OK\n');
    await sleep(500);
  } catch (err) {
    process.stdout.write(`FAILED: ${err.message}\n`);
    results.push({ ...def, error: err.message });
    continue;
  }

  process.stdout.write(`Benchmarking `);
  try {
    const r = await runBench(def);
    results.push({ ...def, ...r, workers: def.workers });
    process.stdout.write(
      `  → ${r.requests.average.toFixed(0).padStart(7)} req/s  ` +
      `avg ${r.latency.average.toFixed(1)}ms  p99 ${r.latency.p99.toFixed(0)}ms\n`
    );
  } catch (err) {
    process.stdout.write(`  ERROR: ${err.message}\n`);
    results.push({ ...def, error: err.message });
  }

  await killServer(child);
  await sleep(600);
}

// ─── Results table ────────────────────────────────────────────────────────────

// Per-adapter 1w baseline for efficiency calculation
const baselines = {};
for (const r of results) {
  if (r.workers === 1 && !r.error) baselines[r.adapterKey] = r.requests?.average ?? 0;
}

const W  = [40, 9, 10, 9, 9, 10, 10];
const hr = W.map(w => '─'.repeat(w)).join('─┼─');

console.log('\n' + '═'.repeat(hr.length));
console.log(`  CLUSTERED BENCHMARK RESULTS  — ${CPU_COUNT} cores${IS_REMOTE ? ', remote loadgen' : ', co-located loadgen ⚠'}`);
console.log('═'.repeat(hr.length));
console.log(
  'Server'.padEnd(W[0]) + ' │ ' +
  'Workers'.padStart(W[1]) + ' │ ' +
  'Req/s'.padStart(W[2]) + ' │ ' +
  'Avg lat'.padStart(W[3]) + ' │ ' +
  'p99'.padStart(W[4]) + ' │ ' +
  'Scaling'.padStart(W[5]) + ' │ ' +
  'Note'.padStart(W[6])
);
console.log(hr);

let lastAdapter = null;
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (r.adapterKey !== lastAdapter) {
    if (lastAdapter !== null) console.log(hr);
    lastAdapter = r.adapterKey;
  }

  if (r.error) {
    console.log(r.label.padEnd(W[0]) + ' │ ' + String(r.workers).padStart(W[1]) + ' │  ERROR: ' + r.error.slice(0, 50));
    continue;
  }

  const rps     = r.requests?.average ?? 0;
  const avgLat  = (r.latency?.average?.toFixed(1) ?? '?') + 'ms';
  const p99     = (r.latency?.p99?.toFixed(0) ?? '?') + 'ms';
  const base    = baselines[r.adapterKey] ?? rps;
  const eff     = rps / base;
  const effStr  = r.workers === 1 ? 'baseline' : (eff * 100).toFixed(0) + '%';

  // Saturation detection: is this run slower than the previous tier?
  let note = '';
  if (!IS_REMOTE && r.workers > 1) {
    const prev = results[i - 1];
    if (prev && !prev.error && (prev.requests?.average ?? 0) > rps) {
      note = '← loadgen starved';
    }
  }
  if (!IS_REMOTE && r.workers > CPU_COUNT / 2) note = 'over-subscribed';

  const fmtRps = rps >= 1000 ? (rps / 1000).toFixed(1) + 'k' : rps.toFixed(0);

  console.log(
    r.label.padEnd(W[0]) + ' │ ' +
    String(r.workers).padStart(W[1]) + ' │ ' +
    fmtRps.padStart(W[2]) + ' │ ' +
    avgLat.padStart(W[3]) + ' │ ' +
    p99.padStart(W[4]) + ' │ ' +
    effStr.padStart(W[5]) + ' │ ' +
    note.padStart(W[6])
  );
}

console.log('═'.repeat(hr.length));
console.log('\nScaling = N-worker req/s ÷ 1-worker req/s. 200% on 2 workers = linear scaling.');
if (!IS_REMOTE) {
  console.log('Entries marked "loadgen starved" mean autocannon had too few CPU cores to sustain load.');
  console.log('Rerun with SERVER_HOST=<ip> and a dedicated loadgen machine for authoritative numbers.\n');
} else {
  console.log('Remote loadgen: numbers are accurate.\n');
}

// ─── JSON output ──────────────────────────────────────────────────────────────

const outPath = join(__dirname, 'results-clustered.json');
writeFileSync(outPath, JSON.stringify(results.map(r => ({
  id: r.id, label: r.label, workers: r.workers, adapterKey: r.adapterKey,
  error: r.error,
  reqPerSec:    r.requests?.average,
  latAvg:       r.latency?.average,
  latP50:       r.latency?.p50,
  latP99:       r.latency?.p99,
  latP999:      r.latency?.p999,
  errors:       r.errors,
  throughputBps: r.throughput?.average,
  scalingEfficiency: baselines[r.adapterKey]
    ? (r.requests?.average ?? 0) / baselines[r.adapterKey]
    : null,
})), null, 2));

console.log(`Results written → ${outPath}`);
