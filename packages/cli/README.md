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
| `axiomify routes [entry]`   | Inspect every HTTP + WebSocket route (+ snapshot/diff the surface) |
| `axiomify openapi [entry]`  | Generate the OpenAPI 3.1.0 spec (+ `--validate`) |
| `axiomify check [entry]`    | Static production-readiness audit                |
| `axiomify studio [entry]`   | Launch Axiomify Studio visual dashboard          |
| `axiomify doctor`           | Diagnose the host environment                    |
| `axiomify scaffold route`   | Generate a new route file under `src/routes/`    |
| `axiomify migrate`          | Codemod: migrate a v5 project to v6              |
| `axiomify db <subcommand>`  | Run the project's db workflow (migrate/seed/generate/status) |
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

`dev` also accepts `--watch-sdk <langs...>` to automatically regenerate
type-safe SDKs (see `axiomify sdk`) for the given target languages
whenever your source files change:

```bash
axiomify dev --watch-sdk typescript python
```

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

### Route surface snapshot + diff

`--json` emits the machine-readable **route surface**: every route with a
sha256 fingerprint of each validation schema part (`body` / `query` /
`params` / `response`), computed over canonically-sorted JSON Schema
output so hashes only change when a schema genuinely changes.

```bash
axiomify routes --snapshot                 # writes routes-baseline.json
axiomify routes --snapshot main.json       # custom file
# … later, e.g. on a feature branch …
axiomify routes --diff main.json           # exit 1 on breaking changes
axiomify routes --diff main.json --json    # machine-readable, for CI
```

Snapshot output is deterministic (byte-identical repeat runs), so
baselines diff cleanly in git. `--diff` categorises every change:

| Change                             | Severity                                      |
| ---------------------------------- | --------------------------------------------- |
| Route added                        | info                                          |
| Route removed                      | **BREAKING**                                  |
| Method changed (same path)         | **BREAKING**                                  |
| `body`/`query`/`params` schema     | **BREAKING**                                  |
| `response` schema                  | warning (`--strict-response` → **BREAKING**)  |
| Newly deprecated                   | info                                          |

Exit code 1 on any breaking change; `--allow-breaking` reports them but
exits 0 (useful while a break is being intentionally shipped).

## `axiomify openapi`

```bash
axiomify openapi                          # stdout, pretty JSON
axiomify openapi -o openapi.json
axiomify openapi --format yaml -o api.yml
axiomify openapi --minify > spec.min.json
axiomify openapi --title "My API" --spec-version "$(git describe)"
```

Generates the OpenAPI 3.1.0 spec from the app's registered routes.
Useful in CI for client codegen pipelines (`openapi-typescript`,
`openapi-generator`, `oazapfts`) without booting an HTTP listener.

Requires `@axiomify/openapi` to be installed; dynamic-imports it at
runtime and prints a clean error if missing.

### `axiomify openapi --validate`

```bash
axiomify openapi --validate                # human report
axiomify openapi --validate --json         # { valid, findings } for CI
axiomify openapi --validate -o spec.json   # also write the spec
```

Validates the generated document in two layers:

1. **Official OAS 3.1 JSON Schema** — the published
   `spec.openapis.org/oas/3.1/schema/2022-10-07` schema, vendored into the
   CLI and compiled with Ajv's 2020-12 dialect support. (The generator
   emits `openapi: "3.1.0"` exclusively, so 3.1 is the only schema
   shipped; other versions are rejected explicitly.)
2. **Semantic lints** the schema can't express: responses missing
   `description`, duplicate parameter `name`+`in` pairs, `operationId`
   collisions, path template ↔ `in: path` parameter mismatches (both
   directions), and security requirements referencing schemes not
   declared in `components.securitySchemes`.

Each finding is `{ code, severity, location, message }` with `location` a
JSON pointer into the document. Exit code 1 on any `error`-severity
finding — a hard CI gate.

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

## `axiomify scaffold route`

```bash
axiomify scaffold route GET /users/:id
```

Generates a new route file under `src/routes/` from the method and path.
Flags: `--auth` (include the `requireAuth` plugin + import), `--rate-limit`
(include a default rate-limit plugin), `--dir <dir>` (target directory,
default `src/routes`), `--dry-run` (print the source without writing),
and `--force` (overwrite an existing file).

## `axiomify migrate`

```bash
axiomify migrate                 # rewrites files under src/ in place
axiomify migrate --dry-run       # show the unified diff without writing
axiomify migrate --report-only   # print a migration report and exit
axiomify migrate --dir app       # scan a different directory (default: src)
```

v5 → v6 codemod: merges `meta:` fields into `schema:`, renames
`routePrefix` → `prefix`, and applies other breaking-change fixups.

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

### Studio security

Studio is a local developer tool and is hardened accordingly:

- **Loopback only.** The server binds to `127.0.0.1` and rejects any
  request whose `Host` header is not a loopback name (`localhost`,
  `127.0.0.1`, `::1`, `0.0.0.0`) with `403`. This is an anti-DNS-rebinding
  guard so a page you merely visit cannot drive Studio's endpoints.
- **Bearer token.** Every launch mints a random access token. The API,
  the Live Sync WebSocket, and the OTLP receiver endpoints
  (`/__studio/otlp/*`) all require it — the token is embedded in the URL
  Studio opens (`?token=…`) and printed to the console. It is also exposed
  to the loaded app via the `AXIOMIFY_STUDIO_TOKEN` environment variable
  (alongside `AXIOMIFY_STUDIO=true` and `AXIOMIFY_STUDIO_PORT`) so
  telemetry auto-export can authenticate to the receiver.
- **Playground code execution is disabled by default.** The Playground's
  "run snippet" endpoint writes user-supplied code to disk and executes it
  (`node` / `python3` / `dart`) with the full privileges of the Studio
  process and **no sandbox**. It is therefore off by default and returns
  `403` unless you explicitly opt in with `AXIOMIFY_STUDIO_ALLOW_EXEC=true`.
  Only enable this on a trusted, single-user machine — never on a shared
  host — as it is effectively arbitrary code execution.

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

## `axiomify db`

```bash
axiomify db migrate            # run the manifest's migrate command
axiomify db seed --dry-run     # print what would run, execute nothing
axiomify db generate
axiomify db status             # which manifest + commands are configured
```

Runs the project's database workflow through a manifest at the project
root — either `axiomify.db.json` (shell-string commands) or
`axiomify.db.mjs` (may export function commands; requires
`@axiomify/db`). Schema v1:

```json
{
  "version": 1,
  "commands": {
    "migrate": "npx prisma migrate deploy",
    "seed": "node ./scripts/seed.mjs",
    "generate": "npx prisma generate"
  }
}
```

The CLI **never runs anything not explicitly declared in the manifest.**
Shell commands are spawned with inherited stdio and their exit code is
propagated; function commands (`.mjs` manifests) are awaited.

`@axiomify/db` is imported lazily: when it's installed its `loadDbConfig`
loader is used; when it isn't, a built-in reader handles
`axiomify.db.json` so the CLI stands alone (`.mjs` manifests without the
package are a clear error).

`axiomify db status` with no manifest performs best-effort ORM detection
(`prisma/schema.prisma`, `drizzle.config.*`, `knexfile.*`) and prints a
suggested manifest for what it finds.

## `axiomify sdk`

Subcommands for compiling type-safe client SDKs from specs:

```bash
# Generate SDKs for TS, Python, and Go:
axiomify sdk generate spec.json --target typescript python go -o ./sdks

# Validate a schema against the SDK compiler:
axiomify sdk validate spec.json

# Deep structural diff for breaking changes:
axiomify sdk diff old-spec.json new-spec.json

# Get client migration guidance:
axiomify sdk migrate old-spec.json new-spec.json

# Build a generated SDK:
axiomify sdk build

# Publish a generated SDK:
axiomify sdk publish

# Upgrade a generated SDK:
axiomify sdk upgrade

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
- run: npx axiomify openapi --validate # official OAS 3.1 schema + lints
- run: npx axiomify routes --diff routes-baseline.json # exit 1 on breaking changes
- run: npx axiomify sdk validate ./openapi.json # schema verification
- run: npx axiomify sdk diff old-spec.json ./openapi.json # check breaking changes
```

Commit a `routes-baseline.json` (from `axiomify routes --snapshot`) and
the `--diff` step blocks accidental breaking API changes before they
reach production.
