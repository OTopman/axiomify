/**
 * Stress / perf-budget benchmark for real-hardware runs.
 *
 * Difference from `smoke.mjs`:
 *   - smoke runs 3 seconds and asserts only "server didn't crash".
 *   - stress runs 30 seconds across all three core scenarios, asserts
 *     latency budgets, and writes a structured report.
 *
 * Difference from `run-all.mjs`:
 *   - run-all is the comprehensive comparison harness (Axiomify vs
 *     Fastify vs Hapi vs Hono vs bare Node). Multi-server boot. Long.
 *   - stress is a SINGLE-server regression check focused on whether
 *     Axiomify Native itself has regressed against a committed baseline.
 *
 * Intentionally NOT wired into cloud CI — cloud CPU/NIC variance is too
 * high to gate on absolute numbers without flakes. Run this on a quiet
 * Linux box (dedicated VM, bare metal, or a self-hosted runner you trust)
 * BEFORE tagging a release. If any scenario violates its p99 budget,
 * exit code is 2 (regression) so you can diff `stress-result.json`
 * against the last green run to find what slowed down.
 *
 * Usage:
 *   node benchmarks/stress.mjs                         # default 30s per scenario
 *   node benchmarks/stress.mjs --duration 60           # custom duration
 *   node benchmarks/stress.mjs --baseline stress-baseline.json  # compare
 *
 * Output: benchmarks/stress-result.json
 */
import autocannon from 'autocannon';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, 'servers', 'axiomify-native.mjs');
const OUT_PATH = join(__dirname, 'stress-result.json');
const PORT = 3198;

// CLI args — keep parsing trivial; no need for yargs here.
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const DURATION = parseInt(flag('duration', '30'), 10);
const CONNECTIONS = parseInt(flag('connections', '100'), 10);
const PIPELINING = parseInt(flag('pipelining', '10'), 10);
const BASELINE_PATH = flag('baseline', null);

/**
 * Per-scenario latency budgets in milliseconds. These are intentionally
 * generous defaults — pick numbers that real client SLOs would accept,
 * not optimistic synthetic-benchmark p99s. Tighten when you have your
 * own dedicated-hardware baseline.
 *
 * Override per machine via the `--baseline` flag (recommended for
 * regression detection — see `compareToBaseline` below).
 */
const SCENARIOS = [
  {
    id: 'get-ping',
    label: 'GET /ping',
    url: `http://localhost:${PORT}/ping`,
    method: 'GET',
    budgetP99Ms: 50,
    budgetMinReqPerSec: 30_000,
  },
  {
    id: 'get-params',
    label: 'GET /users/:id/posts/:postId',
    url: `http://localhost:${PORT}/users/42/posts/abc`,
    method: 'GET',
    budgetP99Ms: 50,
    budgetMinReqPerSec: 30_000,
  },
  {
    id: 'post-echo',
    label: 'POST /echo',
    url: `http://localhost:${PORT}/echo`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world', n: 42, nested: { a: 1, b: [1, 2, 3] } }),
    budgetP99Ms: 60,
    budgetMinReqPerSec: 20_000,
  },
];

class UwsUnavailableError extends Error {
  constructor() { super('uWS unavailable'); this.name = 'UwsUnavailableError'; }
}

function waitForReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    let stderrBuf = '';
    const onStdout = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[srv] ${text}`);
      if (!done && /(?:^|\n)READY(?:\n|$)/.test(text)) {
        done = true; cleanup(); resolve();
      }
    };
    const onStderr = (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      process.stderr.write(`[srv] ${text}`);
    };
    const onExit = (code) => {
      if (done) return;
      done = true; cleanup();
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
      if (!done) { done = true; cleanup(); reject(new Error(`Boot timeout`)); }
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

async function runScenario(scenario) {
  console.log(
    `[stress] ${scenario.id} — ${scenario.label} (${DURATION}s, ` +
    `c=${CONNECTIONS}, p=${PIPELINING})`,
  );
  const result = await autocannon({
    url: scenario.url,
    method: scenario.method,
    headers: scenario.headers,
    body: scenario.body,
    connections: CONNECTIONS,
    pipelining: PIPELINING,
    duration: DURATION,
  });
  return {
    id: scenario.id,
    label: scenario.label,
    reqPerSec: result.requests.average,
    latAvg: result.latency.average,
    latP50: result.latency.p50,
    latP99: result.latency.p99,
    latP999: result.latency.p999,
    throughputMBs: result.throughput.average / 1_000_000,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx ?? 0,
    budgetP99Ms: scenario.budgetP99Ms,
    budgetMinReqPerSec: scenario.budgetMinReqPerSec,
  };
}

/**
 * Compare every scenario against a previous run's `stress-result.json`.
 * Treats a 15% degradation as a regression — wide enough to absorb noise
 * on the same machine, tight enough to catch a real code change.
 */
function compareToBaseline(current, baselinePath) {
  if (!existsSync(baselinePath)) {
    console.warn(`[stress] --baseline ${baselinePath} not found; skipping comparison.`);
    return [];
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const REGRESSION_THRESHOLD = 0.85; // current must be ≥ 85% of baseline
  const regressions = [];
  for (const scn of current.scenarios) {
    const base = baseline.scenarios?.find((s) => s.id === scn.id);
    if (!base) continue;
    const reqRatio = scn.reqPerSec / base.reqPerSec;
    const latRatio = base.latP99 / scn.latP99; // higher latency = worse → inverted
    if (reqRatio < REGRESSION_THRESHOLD) {
      regressions.push(
        `${scn.id}: req/s ${scn.reqPerSec.toFixed(0)} vs baseline ${base.reqPerSec.toFixed(0)} ` +
        `(${(reqRatio * 100).toFixed(1)}%)`,
      );
    }
    if (latRatio < REGRESSION_THRESHOLD) {
      regressions.push(
        `${scn.id}: p99 ${scn.latP99}ms vs baseline ${base.latP99}ms ` +
        `(${(latRatio * 100).toFixed(1)}%)`,
      );
    }
  }
  return regressions;
}

async function main() {
  console.log(`[stress] booting ${SERVER_PATH} on :${PORT}`);
  const server = spawn(process.execPath, [SERVER_PATH, String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let scenarios;
  try {
    await waitForReady(server);
    console.log(`[stress] server ready; running ${SCENARIOS.length} scenarios`);
    scenarios = [];
    for (const scn of SCENARIOS) {
      scenarios.push(await runScenario(scn));
    }
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (server.exitCode === null) server.kill('SIGKILL');
  }

  const report = {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    duration: DURATION,
    connections: CONNECTIONS,
    pipelining: PIPELINING,
    scenarios,
  };
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(`[stress] wrote ${OUT_PATH}`);

  // Per-scenario budget assertions. Soft fail (exit 2) — distinguishes
  // "perf regressed" from "harness broke" (exit 1).
  const budgetViolations = [];
  for (const scn of scenarios) {
    if (scn.non2xx > 0 || scn.errors > 0) {
      throw new Error(
        `[stress] ${scn.id}: ${scn.non2xx} non-2xx / ${scn.errors} errors — server broken`,
      );
    }
    if (scn.latP99 > scn.budgetP99Ms) {
      budgetViolations.push(
        `${scn.id}: p99 ${scn.latP99}ms > budget ${scn.budgetP99Ms}ms`,
      );
    }
    if (scn.reqPerSec < scn.budgetMinReqPerSec) {
      budgetViolations.push(
        `${scn.id}: ${scn.reqPerSec.toFixed(0)} req/s < budget ${scn.budgetMinReqPerSec}`,
      );
    }
  }

  if (BASELINE_PATH) {
    const regressions = compareToBaseline(report, BASELINE_PATH);
    budgetViolations.push(...regressions);
  }

  if (budgetViolations.length > 0) {
    console.error(`[stress] BUDGET VIOLATIONS:\n  ${budgetViolations.join('\n  ')}`);
    process.exit(2);
  }
  console.log('[stress] all scenarios within budget');
}

main().catch((err) => {
  if (err instanceof UwsUnavailableError) {
    console.warn(
      '[stress] SKIPPED — uWebSockets.js native binding unavailable on this host.',
    );
    process.exit(0);
  }
  console.error('[stress] FAILED:', err.message);
  process.exit(1);
});
