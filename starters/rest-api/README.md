# Axiomify REST API starter

A small, production-oriented JSON API that you can copy into a new repository.
It deliberately uses an in-memory task store so its boundaries are easy to
replace with your database layer.

## Included defaults

- Versioned `/api/v1` routes with Zod input and response contracts
- Request IDs, structured logs, W3C trace context, and `Server-Timing`
- Helmet, security filtering, explicit CORS, and rate limiting
- A contract test using `@axiomify/testing`
- A two-stage Docker image

## Run locally

```bash
npm install
npm run dev
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Ship it"}'
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `CORS_ORIGIN` | unset | Exact browser origin allowed by CORS |
| `LOG_LEVEL` | `info` | Set to `debug` for request diagnostics |

## Deploy with Docker

```bash
docker build -t my-api .
docker run --rm -p 3000:3000 -e CORS_ORIGIN=https://app.example.com my-api
```

Before production deployment, replace the in-memory task map with a durable
database, use Redis-backed rate limits for multiple replicas, set a concrete
`CORS_ORIGIN`, and add authentication for non-public endpoints. Pin all
`@axiomify/*` packages to the same release version.
