# @axiomify/cli

The Axiomify command-line interface — scaffold projects, run the dev server, and inspect routes.

## Install

```bash
npm install -g @axiomify/cli
# or use without installing:
npx @axiomify/cli init my-api
```

## Commands

### `axiomify init <name>`

Scaffolds a new Axiomify project with your chosen adapter.

```bash
axiomify init my-api
```

Prompts:

1. **Adapter** — Native (uWS, fastest) *(default)*, Fastify, Express, Hapi, or Node HTTP
2. **Plugins** — Auth, CORS, Helmet, Rate Limit, Metrics, Logger, OpenAPI (multi-select)
3. **Language** — TypeScript *(default)* or JavaScript

Generates:
```
my-api/
├── src/
│   ├── index.ts          # Entry point with chosen adapter
│   ├── routes/           # Example routes
│   └── plugins/          # Plugin configuration
├── package.json
├── tsconfig.json
└── README.md
```

### `axiomify dev`

Starts the development server with hot-reload powered by esbuild.

```bash
axiomify dev                 # watches src/, rebuilds on change
axiomify dev --port 4000     # custom port
axiomify dev --debug         # verbose logging
```

### `axiomify build`

Compiles the application for production.

```bash
axiomify build               # outputs to dist/
axiomify build --minify      # minified output
axiomify build --sourcemap   # include source maps
```

### `axiomify routes`

Visualises all registered routes in a table.

```bash
axiomify routes

┌─────────────────────────────────────┬────────┬───────────────────────────────┐
│ Path                                │ Method │ Plugins                       │
├─────────────────────────────────────┼────────┼───────────────────────────────┤
│ /users                              │ GET    │ requireAuth, rateLimiter       │
│ /users                              │ POST   │ requireAuth                   │
│ /users/:id                          │ GET    │ requireAuth                   │
│ /auth/login                         │ POST   │ loginRateLimit                │
│ /auth/refresh                       │ POST   │ refreshRateLimit              │
│ /health                             │ GET    │ —                             │
│ /metrics                            │ GET    │ —                             │
└─────────────────────────────────────┴────────┴───────────────────────────────┘
```

## Adapter choices in `axiomify init`

| Adapter | Req/s (1 core) | Use case |
|---|---:|---|
| **Native (uWS)** | ~50k | Maximum throughput, production APIs |
| **Fastify** | ~10k | Recommended default — best ecosystem balance |
| **Express** | ~5k | Legacy migration, Express middleware ecosystem |
| **Hapi** | ~5k | Enterprise Hapi plugin ecosystem |
| **Node HTTP** | ~10k | Zero dependencies, edge/serverless |
