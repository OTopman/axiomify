# Axiomify Benchmarks

## Results (Node 22, 8-core machine, autocannon 100 conns, pipelining 10, 12 s)

### Single process

| Server | Req/s | Avg lat | p99 | Throughput |
|---|---:|---:|---:|---:|
| Node.js http (bare) | 43,765 | 22 ms | 54 ms | 8.97 MB/s |
| Fastify 5 (bare) | 41,779 | 23 ms | 53 ms | 8.45 MB/s |
| Hapi 21 (bare) | 32,034 | 31 ms | 70 ms | 7.88 MB/s |
| **Axiomify Native — GET /users/:id/posts/:postId** | **83,947** | **11 ms** | **20 ms** | **16.89 MB/s** |
| **Axiomify Native — GET /ping** | **73,511** | **13 ms** | **26 ms** | **13.95 MB/s** |
| **Axiomify Native — POST /echo (JSON body)** | **54,720** | **18 ms** | **30 ms** | **11.12 MB/s** |

Axiomify Native achieves exceptional performance by utilizing `uWebSockets.js` C++ runtime for network I/O, entirely skipping Node.js's internal HTTP abstractions.

### Clustered (co-located loadgen — 4w regresses due to autocannon starvation)

| Server | 1w | 2w | 4w | 2w scaling |
|---|---:|---:|---:|---:|
| Native (uWS) | 85,000 | 91,300 | 90,600† | 107% |

† 4w regresses because autocannon is co-located and loses CPU cores to the extra server workers. This is loadgen starvation, not a server regression.

## Methodology

### Co-located vs dedicated loadgen

autocannon and the server process share the same machine. This is acceptable for single-process benchmarks. For clustered benchmarks:

- Each additional server worker consumes a CPU core
- autocannon gets fewer cores → generates fewer requests per second
- Measured throughput may **decrease** as worker count increases even when the server is faster

This produces the 4-worker regression above. The **2-worker numbers are the most honest** co-located measurement — enough parallelism to prove scaling works, not so many that autocannon is starved.

### Running accurate clustered benchmarks

```bash
# Server machine
WORKERS=6 node benchmarks/servers/axiomify-native-clustered.mjs 3001

# Loadgen machine (separate host)
SERVER_HOST=<server-ip> node benchmarks/run-clustered.mjs
```

The benchmark runner flags rows where `N-worker < (N-1)-worker` throughput as `← loadgen starved`.

### Verifying SO_REUSEPORT is active

After `listenClustered()` starts:

```bash
lsof -i :3000
```

You should see N separate processes each owning a `LISTEN` socket on the same port. If only one process (the primary) appears, SO_REUSEPORT is not active. Verify:

- You're on Linux (macOS / Windows fall back to a userspace L4 proxy — see `allowUserspaceProxy` in [docs/packages/native.md](../docs/packages/native.md#clustering-on-macos--windows)).
- Your kernel supports `SO_REUSEPORT` (Linux ≥ 3.9 — present on every supported distribution).
- The `listenClustered()` call is being made from the primary process; the adapter fans out to workers internally.

## Running the benchmarks

```bash
# Full single-process suite (11 configurations)
node benchmarks/run-all.mjs

# Clustered suite (1w, 2w, 4w native)
node benchmarks/run-clustered.mjs

# With remote loadgen (accurate clustered numbers)
SERVER_HOST=<server-ip> node benchmarks/run-clustered.mjs

# Results written to:
# benchmarks/results.json          (single-process)
# benchmarks/results-clustered.json (clustered)
```

## Quick checks vs full runs

This directory has three benchmark entry points with different cost/precision tradeoffs:

| Script | Duration | Asserts | Use case |
|---|---|---|---|
| `smoke.mjs` | ~5 s | server didn't crash, ≥1k req/s | Every PR. CI-friendly. Skips cleanly on hosts without uWS. |
| `stress.mjs` | ~90 s (30 s × 3 scenarios) | p99 budgets, optional baseline diff | Pre-release sanity check on dedicated hardware. |
| `run-all.mjs` | ~3-5 min | none (writes raw results) | Cross-framework comparison (Axiomify vs Fastify vs Hapi vs bare Node). |

### Stress (`stress.mjs`) — perf-budget regression detection

```bash
# Default 30s per scenario
node benchmarks/stress.mjs

# Custom load
node benchmarks/stress.mjs --duration 60 --connections 200 --pipelining 16

# Diff against a previous run's report — fails (exit 2) if any scenario
# regressed by more than 15% in req/s or p99 latency.
node benchmarks/stress.mjs --baseline benchmarks/stress-baseline.json
```

Output: `benchmarks/stress-result.json`. Exit codes:
- `0` — all scenarios within budget (and within baseline if provided)
- `1` — harness/server broke (non-2xx responses, boot failure)
- `2` — budget or baseline violation

The default budgets in `stress.mjs` are intentionally generous (30k req/s floor, 50-60ms p99). Tighten them on your own hardware by committing a `stress-baseline.json` and passing `--baseline`.

**Do not run this on cloud CI runners.** Shared cores + virtualised NICs make the variance too high to gate on. Use `smoke.mjs` in CI; reserve `stress.mjs` for a quiet box you control.

## Worker count recommendations

| Machine | Recommended `workers` |
|---|---|
| 2-core bare metal | `2` |
| 4-core bare metal | `4` |
| 8-core bare metal | `6–7` (leave 1–2 for OS) |
| 4-core Docker (`--cpus=4`) | `4` (availableParallelism returns 4) |
| 2-core Kubernetes pod | `2` |

The default (`os.availableParallelism()`) is correct in most cases. Set `workers` explicitly in production to make the configuration visible and auditable.
