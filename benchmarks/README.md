Here is the production-ready markdown for your `benchmarks/README.md` file, incorporating the data and architectural analysis we just verified.

```markdown
# Axiomify Benchmarks

This directory contains the performance benchmarking suite for the Axiomify framework, comparing the overhead and throughput of our supported HTTP server adapters against raw Node.js implementations.

## Methodology

All benchmarks are executed using [`autocannon`](https://github.com/mcollina/autocannon) against a simple `/ping` endpoint returning a lightweight JSON payload. The tests are designed to heavily saturate the event loop using HTTP pipelining.

**Test Parameters:**
* Connections: 100
* Duration: 10 seconds
* Pipelining Factor: 10
```bash
autocannon -c 100 -d 10 -p 10 http://localhost:3000/ping
```

## Results

The following metrics represent the maximum throughput and latency characteristics of each Axiomify adapter under heavy load.

| Adapter / Server | Avg Throughput (RPS) | Avg Latency | Max Latency (GC Spikes) | Total Requests / 10s |
| :--- | :--- | :--- | :--- | :--- |
| **Axiomify Native** | **7,153 req/sec** | **138.64 ms** | **425 ms** | **73k** |
| Fastify | 6,285 req/sec | 157.78 ms | 1,576 ms | 64k |
| Raw Node `http` | 5,706 req/sec | 174.05 ms | 2,111 ms | 58k |
| Hapi | 4,817 req/sec | 205.46 ms | 1,560 ms | 49k |
| Express | 3,612 req/sec | 272.75 ms | 461 ms | 37k |

## Architectural Observations

1. **Native Dominance:** The Axiomify Native adapter completely bypasses traditional framework overhead, processing over 73,000 requests in 10 seconds and outperforming highly optimized routers like Fastify.
2. **Zero-Allocation Memory Safety:** Fastify, Hapi, and the raw Node `http` baseline all exhibit severe Max Latency spikes (1.5s - 2.1s). This is caused by short-lived object allocations triggering aggressive V8 "stop-the-world" garbage collection cycles. The Axiomify Native adapter utilizes zero-allocation routing, eliminating these GC stalls and capping max latency at a highly deterministic 425ms.
3. **The Express Bottleneck:** The Express adapter hits a hard ceiling at ~3,600 RPS due to synchronous linear middleware traversal and heavy request/response object wrapping.

## Running Locally

To reproduce these results, ensure your local environment is clean and execute the benchmark runner. Do not run other heavy processes simultaneously, as it will skew the V8 event loop metrics.
```bash
# Ensure the runner is executable
chmod +x benchmarks/run.sh

# Execute the suite
./benchmarks/run.sh
