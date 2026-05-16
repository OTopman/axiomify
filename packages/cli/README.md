# @axiomify/cli

The official CLI for the Axiomify framework — scaffold projects, run the
dev server, build production bundles, inspect routes, generate OpenAPI
specs, and audit production readiness.

## Install

```bash
npm install -D @axiomify/cli
# or invoke without installing:
npx @axiomify/cli init my-api
```

Per-project install is recommended so the CLI version stays pinned to
the same major as your `@axiomify/*` runtime packages.

## Commands at a glance

| Command | Purpose |
|---|---|
| `axiomify init [directory]` | Bootstrap a new project |
| `axiomify dev [entry]` | Hot-reload dev server (esbuild watch) |
| `axiomify build [entry]` | Compile a production bundle to `dist/` |
| `axiomify routes [entry]` | Inspect every HTTP + WebSocket route |
| `axiomify openapi [entry]` | Generate the OpenAPI 3.0.3 spec |
| `axiomify check [entry]` | Static production-readiness audit |
| `axiomify doctor` | Diagnose the host environment |

`[entry]` defaults to `src/index.ts` everywhere it's accepted.

For the full reference (flags, exit codes, CI examples), see
[`docs/packages/cli.md`](../../docs/packages/cli.md).

## `axiomify init`

```bash
axiomify init my-api
```

Interactive scaffolder. Prompts for project name (when no directory
argument is given), description, package manager (npm / pnpm / yarn),
optional ESLint + Prettier + EditorConfig, git initialisation, and
whether to run install automatically.

The generated `src/index.ts` registers `helmet`, `cors`, `security`,
`rate-limit`, `fingerprint`, and `logger` with sane defaults. Pass
`-f, --force` to overwrite existing files.

## `axiomify dev` / `axiomify build`

```bash
axiomify dev               # watches src/, restarts on change
axiomify build             # bundles to dist/index.js
```

Both use esbuild. `dev` sends SIGTERM first so your `gracefulShutdown`
hooks can drain, with a SIGKILL fallback after 3 seconds.

## `axiomify routes`

Inspects the app *without* booting a listener. Prints a
Unicode-bordered table with colour-coded HTTP methods, validation
badges, OpenAPI tags + `operationId`, plugin count, timeout, and
deprecation marker.

```
  🧭 Axiomify routes

┌─────────┬──────────────────────┬───────────────┬───────────────────────────────────────┐
│ METHOD  │ PATH                 │ VALIDATION    │ META                                  │
├─────────┼──────────────────────┼───────────────┼───────────────────────────────────────┤
│ WS      │ /chat                │ Message       │ —                                     │
│ GET     │ /health              │ —             │ —                                     │
│ POST    │ /users ⊘ DEPRECATED  │ Body,Response │ op:createUser #Users 5000ms +1 plugin │
│ GET     │ /users/:id           │ Params        │ op:getUser #Users                     │
│ DELETE  │ /users/:id           │ Params        │ —                                     │
└─────────┴──────────────────────┴───────────────┴───────────────────────────────────────┘

  ✓ 5 routes   DELETE 1 · GET 2 · POST 1 · WS 1
    └ 1 WebSocket route included
```

Flags: `--json`, `--method GET,POST,WS`, `--filter "/api/v1/*"`,
`--sort path|method`.

WebSocket routes (`app.ws(...)`) appear under the `WS` pseudo-method
alongside HTTP routes — earlier CLI versions silently omitted them.

## `axiomify openapi`

```bash
axiomify openapi                          # stdout, pretty JSON
axiomify openapi -o openapi.json
axiomify openapi --format yaml -o api.yml
axiomify openapi --minify > spec.min.json
axiomify openapi --title "My API" --spec-version "$(git describe)"
```

Generates the OpenAPI 3.0.3 spec from the app's registered routes.
Useful in CI for client codegen pipelines (`openapi-typescript`,
`openapi-generator`, `oazapfts`) without booting an HTTP listener.

Requires `@axiomify/openapi` to be installed; dynamic-imports it at
runtime and prints a clean error if missing.

## `axiomify check`

```bash
axiomify check
```

Static production-readiness audit. Loads the app (no listener) and
flags:

- ✓ pass — configuration is correct
- ⚠ warn — non-fatal smell
- ✗ fail — real defect that blocks ship

Checks include: `enableRequestId()` called, env vars referenced in
source actually set, routes with body schemas declare response schemas,
no deprecated `meta:` field usage, health check registered, OpenAPI docs
protected, security plugins active.

Exit code 1 on any fail — wire into CI to gate deploys.

## `axiomify doctor`

```bash
axiomify doctor
```

Diagnoses the host environment: Node version vs uWS prebuilt support,
platform (Linux ✓ for `SO_REUSEPORT` clustering), `@axiomify/*` package
alignment, uWS bindings load successfully, recent build artefact, port
3000 (or `$PORT`) availability.

Run on a fresh clone or new CI runner before chasing test failures that
turn out to be Node-version mismatches.

## CI example

```yaml
- run: npx axiomify doctor    # environment sanity
- run: npx axiomify check     # static readiness audit
- run: npx axiomify build
- run: npx axiomify openapi -o ./openapi.json --spec-version "$GITHUB_SHA"
- run: npx axiomify routes --json > routes.json   # surface snapshot
```

Diff `routes.json` between commits to detect accidental API changes
before they reach production.
