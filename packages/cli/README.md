# @axiomify/cli

[![npm version](https://img.shields.io/npm/v/@axiomify/cli.svg)](https://npmjs.com/package//@axiomify/cli)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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

| Command                     | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| `axiomify init [directory]` | Bootstrap a new project                          |
| `axiomify dev [entry]`      | Hot-reload dev server (esbuild watch)            |
| `axiomify build [entry]`    | Compile a production bundle to `dist/`           |
| `axiomify routes [entry]`   | Inspect every HTTP + WebSocket route             |
| `axiomify openapi [entry]`  | Generate the OpenAPI 3.1.0 spec                  |
| `axiomify check [entry]`    | Static production-readiness audit                |
| `axiomify studio [entry]`   | Launch Axiomify Studio visual dashboard          |
| `axiomify doctor`           | Diagnose the host environment                    |
| `axiomify sdk <subcommand>` | Manage, generate, build, validate, and diff SDKs |

`[entry]` defaults to `src/index.ts` everywhere it's accepted.

For the full reference (flags, exit codes, CI examples), see
[`./docs/packages/cli.md`](https://github.com/OTopman/axiomify/blob/main/docs/packages/cli.md).

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

Inspects the app _without_ booting a listener. Prints a
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

## `axiomify studio`

```bash
axiomify studio [entry]
```

Launches Axiomify Studio — a premium visual developer dashboard that serves as a control center for your API. It inspects your application's:

- **Route Inspector**: Search, filter, and drill down into HTTP & WebSocket routes.
- **Schema Inspector**: Browse and inspect JSON schemas compiled from Zod validators.
- **OpenAPI Spec Viewer**: Render collapsible tree views of OpenAPI paths and operations.
- **Lifecycle Hooks**: Review registered hook handlers across request lifecycle phases.
- **Health Dashboard**: Inspect production-readiness finding audits (pass/warn/fail).
- **Request Tester**: Construct and send test requests (GET, POST, etc.) directly against your in-memory Axiomify app instance, capturing response status, headers, and body.

The dashboard uses **Live Sync** (WebSockets) powered by esbuild's watch context to automatically re-compile and refresh the browser interface in real time as you edit your project files.

Flags:

- `-p, --port <number>`: Port to start the Studio server on (default: `4399`, falls back to a random port if busy).
- `--no-open`: Disable auto-opening the dashboard in the browser.

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

## `axiomify sdk`

Subcommands for compiling type-safe client SDKs from specs:

```bash
# Generate SDKs for TS, Python, and Go:
axiomify sdk generate spec.json --target typescript python go -o ./sdks

# Deep structural diff for breaking changes:
axiomify sdk diff old-spec.json new-spec.json

# Get client migration guidance:
axiomify sdk migrate old-spec.json new-spec.json

# Run generation hot-reloads on file change:
axiomify sdk watch spec.json --target typescript python

# Run local toolchain diagnostics:
axiomify sdk doctor

# Run compiler and emitter throughput benchmarks:
axiomify sdk benchmark
```

## CI example

```yaml
- run: npx axiomify doctor # environment sanity
- run: npx axiomify check # static readiness audit
- run: npx axiomify build
- run: npx axiomify openapi -o ./openapi.json --spec-version "$GITHUB_SHA"
- run: npx axiomify routes --json > routes.json # surface snapshot
- run: npx axiomify sdk validate ./openapi.json # schema verification
- run: npx axiomify sdk diff old-spec.json ./openapi.json # check breaking changes
```

Diff `routes.json` between commits to detect accidental API changes
before they reach production.
