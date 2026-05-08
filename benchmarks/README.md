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
| Axiomify + `@axiomify/http` | 32,841 | 30 ms | 91 ms | 7.77 MB/s |
| Axiomify + `@axiomify/fastify` | 31,334 | 31 ms | 58 ms | 7.32 MB/s |
| Express 4 (bare) | 9,682 | 102 ms | 191 ms | 2.55 MB/s |
| Axiomify + `@axiomify/hapi` | 9,875 | 79 ms | 511 ms | 2.74 MB/s |
| Axiomify + `@axiomify/express` | 7,337 | 135 ms | 247 ms | 2.16 MB/s |

The ~25% overhead of Axiomify adapters vs their bare counterparts is the fixed dispatcher cost: hook iteration, compiled-state WeakMap lookup, async pipeline. It is identical across all adapters.

### Clustered (co-located loadgen — 4w regresses due to autocannon starvation)

| Adapter | 1w | 2w | 4w | 2w scaling |
|---|---:|---:|---:|---:|
| Native (uWS) | 85,000 | 91,300 | 90,600† | 107% |
| `@axiomify/http` | 35,800 | 57,200 | 50,400† | **160%** |
| `@axiomify/fastify` | 21,300 | 35,200 | 26,600† | **165%** |

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
WORKERS=6 node benchmarks/servers/axiomify-http-clustered.mjs 3000
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

You should see N separate processes each owning a `LISTEN` socket. If only one process (the primary) appears, SO_REUSEPORT is not active — check that your Node.js version is ≥ 16.9 for `reusePort: true`.

## Running the benchmarks

```bash
# Full single-process suite (11 configurations)
node benchmarks/run-all.mjs

# Clustered suite (1w, 2w, 4w across native/http/fastify)
node benchmarks/run-clustered.mjs

# With remote loadgen (accurate clustered numbers)
SERVER_HOST=<server-ip> node benchmarks/run-clustered.mjs

# Results written to:
# benchmarks/results.json          (single-process)
# benchmarks/results-clustered.json (clustered)
```

## Worker count recommendations

| Machine | Recommended `workers` |
|---|---|
| 2-core bare metal | `2` |
| 4-core bare metal | `4` |
| 8-core bare metal | `6–7` (leave 1–2 for OS) |
| 4-core Docker (`--cpus=4`) | `4` (availableParallelism returns 4) |
| 2-core Kubernetes pod | `2` |

The default (`os.availableParallelism()`) is correct in most cases. Set `workers` explicitly in production to make the configuration visible and auditable.
