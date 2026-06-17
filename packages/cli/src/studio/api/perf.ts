/**
 * Studio Performance Observatory
 *
 * Collects per-route, per-middleware, per-service, and per-query latency
 * samples from both Studio proxy requests and real production traffic.
 * Computes running P50 / P95 / P99 percentiles using reservoir sampling
 * (capped at MAX_SAMPLES per bucket to bound memory usage).
 *
 * GET    /__studio/api/perf   — full performance snapshot
 * DELETE /__studio/api/perf   — reset all stats
 */
import type { ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SAMPLES = 5_000; // Per bucket — after this, evict oldest
const TOP_N = 20; // Rows returned per ranking table

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LatencyBucket {
  route: string;
  method: string;
  samples: number[];
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  lastSeenAt: string;
}

export interface MiddlewareLatencyBucket {
  name: string;
  samples: number[];
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

export interface ServiceLatencyBucket {
  token: string;
  method: string;
  samples: number[];
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

export interface TimelineStep {
  name: string;
  type: string;
  duration: number;
}

// ─── Stores ───────────────────────────────────────────────────────────────────

const routeLatencies = new Map<string, LatencyBucket>();
const middlewareLatencies = new Map<string, MiddlewareLatencyBucket>();
const serviceLatencies = new Map<string, ServiceLatencyBucket>();
const queryAllSamples: number[] = [];
const querySlowSamples: {
  query: string;
  durationMs: number;
  timestamp: string;
}[] = [];

let statsResetAt = new Date().toISOString();

// ─── Percentile Computation ───────────────────────────────────────────────────

export function computePercentiles(samples: number[]): {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
} {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
  }

  const sorted = samples.slice().sort((a, b) => a - b);
  const len = sorted.length;
  const p = (percentile: number) => {
    const idx = Math.ceil((percentile / 100) * len) - 1;
    return Math.round(sorted[Math.max(0, idx)] * 100) / 100;
  };
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    p50: p(50),
    p95: p(95),
    p99: p(99),
    avg: Math.round((sum / len) * 100) / 100,
    min: sorted[0],
    max: sorted[len - 1],
  };
}

function addSample(arr: number[], value: number): void {
  if (arr.length >= MAX_SAMPLES) {
    arr.splice(0, Math.ceil(MAX_SAMPLES * 0.1)); // evict oldest 10%
  }
  arr.push(value);
}

// ─── Recording API ────────────────────────────────────────────────────────────

export function recordLatency(
  route: string,
  method: string,
  totalDurationMs: number,
  timeline: TimelineStep[],
  queryDurations: { query: string; durationMs: number }[],
): void {
  const key = `${method}:${route}`;

  // Route bucket
  let bucket = routeLatencies.get(key);
  if (!bucket) {
    bucket = {
      route,
      method,
      samples: [],
      count: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      avg: 0,
      min: 0,
      max: Infinity,
      lastSeenAt: '',
    };
    routeLatencies.set(key, bucket);
  }
  addSample(bucket.samples, totalDurationMs);
  bucket.count++;
  bucket.lastSeenAt = new Date().toISOString();
  Object.assign(bucket, computePercentiles(bucket.samples));

  // Middleware/Hook buckets from timeline
  for (const step of timeline) {
    if (!step.name || step.duration == null) continue;
    const mKey = step.name;
    let mBucket = middlewareLatencies.get(mKey);
    if (!mBucket) {
      mBucket = {
        name: step.name,
        samples: [],
        count: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        avg: 0,
      };
      middlewareLatencies.set(mKey, mBucket);
    }
    addSample(mBucket.samples, step.duration);
    mBucket.count++;
    const { p50, p95, p99, avg } = computePercentiles(mBucket.samples);
    mBucket.p50 = p50;
    mBucket.p95 = p95;
    mBucket.p99 = p99;
    mBucket.avg = avg;
  }

  // Query samples
  for (const qry of queryDurations) {
    addSample(queryAllSamples, qry.durationMs);
    if (querySlowSamples.length >= 200) querySlowSamples.shift();
    querySlowSamples.push({
      query: qry.query,
      durationMs: qry.durationMs,
      timestamp: new Date().toISOString(),
    });
  }

  notifyPerfUpdated();
}

export function recordServiceLatency(
  token: string,
  method: string,
  durationMs: number,
): void {
  const key = `${token}.${method}`;
  let bucket = serviceLatencies.get(key);
  if (!bucket) {
    bucket = {
      token,
      method,
      samples: [],
      count: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      avg: 0,
    };
    serviceLatencies.set(key, bucket);
  }
  addSample(bucket.samples, durationMs);
  bucket.count++;
  const { p50, p95, p99, avg } = computePercentiles(bucket.samples);
  bucket.p50 = p50;
  bucket.p95 = p95;
  bucket.p99 = p99;
  bucket.avg = avg;
  notifyPerfUpdated();
}

// ─── WS Notification ──────────────────────────────────────────────────────────

let onPerfUpdatedCb: (() => void) | null = null;

export function setOnPerfUpdated(cb: () => void): void {
  onPerfUpdatedCb = cb;
}

export function notifyPerfUpdated(): void {
  onPerfUpdatedCb?.();
}

// ─── Snapshot Builders ────────────────────────────────────────────────────────

function topRoutes(): LatencyBucket[] {
  return Array.from(routeLatencies.values())
    .sort((a, b) => b.p99 - a.p99)
    .slice(0, TOP_N)
    .map(({ samples: _s, ...rest }) => rest as any);
}

function topMiddleware(): MiddlewareLatencyBucket[] {
  return Array.from(middlewareLatencies.values())
    .sort((a, b) => b.p99 - a.p99)
    .slice(0, 15)
    .map(({ samples: _s, ...rest }) => rest as any);
}

function topServices(): ServiceLatencyBucket[] {
  return Array.from(serviceLatencies.values())
    .sort((a, b) => b.p99 - a.p99)
    .slice(0, 15)
    .map(({ samples: _s, ...rest }) => rest as any);
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

export function handleGetPerf(_req: any, res: ServerResponse): void {
  const queryPercentiles = computePercentiles(queryAllSamples);
  const slowestQueries = querySlowSamples
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 20);

  sendJson(res, {
    resetAt: statsResetAt,
    routes: topRoutes(),
    middleware: topMiddleware(),
    services: topServices(),
    queries: {
      ...queryPercentiles,
      count: queryAllSamples.length,
      slowest: slowestQueries,
    },
    overall: computePercentiles([
      ...Array.from(routeLatencies.values()).flatMap((b) => b.samples),
    ]),
  });
}

export function handleDeletePerf(_req: any, res: ServerResponse): void {
  routeLatencies.clear();
  middlewareLatencies.clear();
  serviceLatencies.clear();
  queryAllSamples.length = 0;
  querySlowSamples.length = 0;
  statsResetAt = new Date().toISOString();
  notifyPerfUpdated();
  sendJson(res, { success: true });
}

export function getRouteLatenciesMap(): Map<string, LatencyBucket> {
  return routeLatencies;
}
