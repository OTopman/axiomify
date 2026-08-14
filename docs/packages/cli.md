# @axiomify/cli

The official CLI for the Axiomify framework — scaffolding, dev server,
build, route inspection, OpenAPI generation, and production-readiness
checks.

## Install

```bash
npm install -D @axiomify/cli
```

Globally is fine too, but the per-project install pins the CLI to the
same major version as the rest of your `@axiomify/*` packages — recommended.

## Commands

| Command                                   | Purpose                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `axiomify init [directory]`               | Bootstrap a new project                                                          |
| `axiomify dev [entry]`                    | Dev server with hot-reload                                                       |
| `axiomify build [entry]`                  | Compile a production bundle                                                      |
| `axiomify routes [entry]`                 | Inspect every registered HTTP + WebSocket route                                  |
| `axiomify openapi [entry]`                | Generate the OpenAPI spec to stdout or file                                      |
| `axiomify check [entry]`                  | Static production-readiness audit                                                |
| `axiomify studio [entry]`                 | Launch Axiomify Studio visual dashboard                                          |
| `axiomify doctor`                         | Diagnose the host environment                                                    |
| `axiomify scaffold route <method> <path>` | Generate a new route file under `src/routes/`                                    |
| `axiomify migrate`                        | v4 → v5 codemod (rename `meta`→`openapi`, `useSwagger`→`useOpenAPI`, etc.)       |
| `axiomify db <subcommand>`                | Run the project's database workflow (`migrate` / `seed` / `generate` / `status`) |
| `axiomify sdk <subcommand>`               | Generate, validate, and diff multi-language type-safe SDKs                       |

`[entry]` defaults to `src/index.ts` in every command that takes one.

---

## `axiomify init`

Interactive scaffolding. Prompts for:

- Project name (when no target directory is supplied)
- Project description
- Optional ESLint + Prettier + EditorConfig
- Package manager (`npm` / `pnpm` / `yarn`)
- Git initialisation
- Whether to run install immediately

The generated `src/index.ts` registers `helmet`, `cors`, `security`,
`rate-limit`, `fingerprint`, and `logger` so the new project starts with
sane defaults. Pass `-f, --force` to overwrite existing files.

## `axiomify dev`

```bash
axiomify dev               # src/index.ts
axiomify dev src/app.ts
axiomify dev --watch-sdk typescript python # Start dev server with background SDK generation
```

esbuild watch mode. Spawns the bundled file as a Node child process,
restarting on every successful rebuild. SIGTERM is sent first (so the
user's `gracefulShutdown` hooks can drain), with a SIGKILL fallback after
3 seconds.

### Flags

| Flag                     | Description                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `--watch-sdk <langs...>` | Continuously rebuild SDKs for the specified languages in the background upon successful application compilation. |

## `axiomify build`

```bash
axiomify build
```

Bundles the app to `dist/index.js` via esbuild (`target: node18`,
`minify: true`, `keepNames: true`). External dependencies — anything in
your `package.json`'s `dependencies` / `devDependencies` plus
`uWebSockets.js` — are left unbundled.

## `axiomify routes`

```bash
axiomify routes
```

Inspects the user's app _without_ booting a listener and prints a
Unicode-bordered table of every HTTP and WebSocket route, colour-coded by
method, with validation badges, OpenAPI tags, `operationId`, plugin
count, timeout, and deprecation marker:

```
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

### Flags

| Flag                     | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `--json`                 | Emit the machine-readable route surface (see below) instead of the table    |
| `--snapshot [file]`      | Write the route surface to a baseline file (default `routes-baseline.json`) |
| `--diff <baseline>`      | Compare the current surface against a baseline; exit 1 on breaking changes  |
| `--strict-response`      | With `--diff`: response-schema changes become breaking instead of warnings  |
| `--allow-breaking`       | With `--diff`: report breaking changes but exit 0                           |
| `-m, --method <list>`    | Comma-separated method filter: `--method GET,POST,WS`                       |
| `-f, --filter <pattern>` | Path filter — substring match or glob with `*`: `--filter "/api/v1/*"`      |
| `-s, --sort <by>`        | `path` (default) or `method`                                                |

### Route surface snapshot + diff

`--json` / `--snapshot` emit the **route surface** — the app's API
contract in machine-readable form:

```json
{
  "version": 1,
  "routes": [
    {
      "method": "GET",
      "path": "/users/:id",
      "schemaHashes": {
        "params": "7717dd85…",
        "response": "23eb326d…"
      },
      "tags": ["users"]
    }
  ]
}
```

`schemaHashes` are sha256 fingerprints of each validation schema part
(`body` / `query` / `params` / `response`), computed over
canonically-sorted JSON Schema output (the same Zod → JSON Schema
conversion `@axiomify/openapi` uses). A hash changes exactly when the
schema's meaning changes — never because of key order or registration
order. Snapshot output is deterministic: repeat runs are byte-identical,
so committed baselines diff cleanly in git.

```bash
axiomify routes --snapshot                 # writes routes-baseline.json
# … later, on a feature branch …
axiomify routes --diff routes-baseline.json
axiomify routes --diff routes-baseline.json --json   # for CI tooling
```

`--diff` categorises every change:

| Change                             | Severity                                     |
| ---------------------------------- | -------------------------------------------- |
| Route added                        | info                                         |
| Route removed                      | **BREAKING**                                 |
| Method changed (same path)         | **BREAKING**                                 |
| `body` / `query` / `params` schema | **BREAKING**                                 |
| `response` schema                  | warning (`--strict-response` → **BREAKING**) |
| Newly deprecated                   | info                                         |

**Exit code 1** on any breaking change; `--allow-breaking` still prints
the report but exits 0. Baselines produced by older CLIs (bare `--json`
arrays without `schemaHashes`) are accepted — schema comparison is
skipped for entries with no fingerprints.

### Requirements

The entry file MUST export an `Axiomify` instance as `app` (named) or
default. The CLI requires the compiled bundle to inspect routes; if your
entry file calls `adapter.listen()` at the top level, wrap it:

```ts
if (require.main === module) {
  adapter.listen();
}
```

A 5-second timeout warns you if the entry file appears to be starting a
server during inspection.

## `axiomify openapi`

```bash
axiomify openapi                          # stdout, JSON, 2-space indent
axiomify openapi -o openapi.json          # write to file
axiomify openapi --format yaml -o api.yml
axiomify openapi --minify > spec.min.json
axiomify openapi --title "My API" --spec-version "$(git describe)"
```

Generates the OpenAPI 3.1.0 spec from the app and emits it. Useful in CI
for client codegen (`openapi-typescript`, `openapi-generator`,
`oazapfts`) without booting an HTTP listener.

### Flags

| Flag                       | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `-o, --output <file>`      | Write to this file path instead of stdout                            |
| `--format <fmt>`           | `json` (default) or `yaml`                                           |
| `--minify`                 | Single-line JSON (ignored for yaml)                                  |
| `--title <title>`          | Override `info.title` in the generated spec                          |
| `--spec-version <version>` | Override `info.version`                                              |
| `--validate`               | Validate the generated spec instead of emitting it; exit 1 on errors |
| `--json`                   | With `--validate`: emit `{ valid, findings }` JSON                   |

> `--spec-version` is named that way (rather than `--version`) to avoid
> colliding with `commander`'s global `--version` flag.

Requires `@axiomify/openapi` to be installed in the target project. The
CLI imports it dynamically and prints a clean error if it's missing.

### `axiomify openapi --validate`

```bash
axiomify openapi --validate                # human report
axiomify openapi --validate --json         # machine-readable findings
axiomify openapi --validate -o spec.json   # validate AND write the spec
```

Validates the generated document in two layers:

1. **Official OAS 3.1 JSON Schema.** The published
   `https://spec.openapis.org/oas/3.1/schema/2022-10-07` document is
   vendored into the CLI (`src/schemas/oas-3.1.json`, byte-exact) and
   compiled with Ajv's JSON Schema 2020-12 dialect support
   (`ajv/dist/2020`). Because Ajv's `$dynamicRef` support is limited, the
   schema's `{"$dynamicRef": "#meta"}` references are rewritten to a
   static `$ref` at load time — semantically identical for the published
   schema (its `$defs/schema` is non-recursive), and the standard
   workaround used across the ecosystem. `@axiomify/openapi` emits
   `openapi: "3.1.0"` exclusively, so only the 3.1 schema is shipped;
   documents declaring any other version fail with an explicit
   `oas-version-unsupported` error rather than being mis-validated.
2. **Semantic lints** beyond the schema's reach:

   | Code                           | Severity | Catches                                                  |
   | ------------------------------ | -------- | -------------------------------------------------------- |
   | `response-missing-description` | error    | Response objects without the required `description`      |
   | `duplicate-parameter`          | error    | Duplicate parameter `name`+`in` pairs on an operation    |
   | `duplicate-operation-id`       | error    | The same `operationId` used by two operations            |
   | `path-param-missing`           | error    | Path template variable with no matching `in: path` param |
   | `path-param-unused`            | error    | `in: path` parameter with no matching template variable  |
   | `orphaned-security-scheme`     | error    | Security requirement naming an undeclared securityScheme |
   | `empty-paths`                  | warn     | Document with no paths at all                            |

Every finding is `{ code, severity: "error" | "warn", location, message }`
where `location` is a JSON pointer into the document (e.g.
`/paths/~1users~1{id}/get/responses/200`). **Exit code 1** on any
error-severity finding — a hard CI gate; warnings alone exit 0.

## `axiomify check`

```bash
axiomify check
```

Static production-readiness audit. Loads the app (no listener) and runs
a battery of checks against the registered routes, hook configuration,
and environment:

- `enableRequestId()` called?
- `JWT_SECRET` (and other referenced env vars) set?
- Every route with a `body` schema also has a `response` schema?
- Any routes still using the deprecated `meta:` field (removed in 6.0)?
- Health-check route registered?
- OpenAPI docs endpoint exposed without a `protect` callback in production?
- Security plugins (`helmet` / `cors` / `security`) registered?

Output uses three severities:

- ✓ pass — configuration is correct
- ⚠ warn — non-fatal smell
- ✗ fail — real defect that blocks ship

**Exit code 0** when no fails; **exit 1** when at least one fail. Run in
CI to gate deploys.

## `axiomify studio`

```bash
axiomify studio
axiomify studio src/index.ts --port 5000
```

Launches **Axiomify Studio** — a premium visual developer dashboard for inspecting and testing your API.

### Features

- **Route Inspector**: Search, filter, and drill down into HTTP & WebSocket routes.
- **Schema Inspector**: Browse and inspect JSON schemas compiled from Zod validators.
- **OpenAPI Spec Viewer**: Render collapsible tree views of OpenAPI paths and operations.
- **Lifecycle Hooks**: Review registered hook handlers across request lifecycle phases.
- **Health Dashboard**: Inspect production-readiness finding audits (pass/warn/fail).
- **Request Tester**: Construct and send test requests directly against your in-memory Axiomify app instance, including cookies, Server-Sent Events, streams, and multipart file uploads.
- **Session Recorder**: Inspect or export request sessions as JSON or HAR. Authorization, cookies, passwords, tokens, and configured sensitive fields are redacted before recorder and replay history storage; body capture can be disabled in Studio.
- **OTLP Metrics**: Receive OTLP HTTP/JSON gauges, sums, histograms, exponential histograms, and summaries locally; inspect or clear them in Analytics—no hosted telemetry account required.

### Live Sync

The dashboard uses WebSockets powered by esbuild's watch context to automatically re-compile and refresh the browser interface in real time as you edit your project files.

### Flags

| Flag                  | Description                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| `-p, --port <number>` | Port to start the Studio server on (default: `4399`, falls back to random port) |
| `--no-open`           | Disable auto-opening the dashboard in the browser                               |

## `axiomify scaffold route`

```bash
axiomify scaffold route GET /users/:id
axiomify scaffold route POST /users --auth
axiomify scaffold route WS /chat --rate-limit
axiomify scaffold route DELETE /users/:id --dry-run     # preview, no write
```

Generates a TypeScript route file under `src/routes/` (configurable via
`--dir`) with Zod schemas pre-stubbed for path params + request body and
an `openapi:` block scaffolded with sensible defaults.

### Flags

| Flag           | Description                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `--auth`       | Include `requireAuth` plugin and the corresponding import                                               |
| `--rate-limit` | Include a default `createRateLimitPlugin` with `MemoryStore` (replace with `RedisStore` for production) |
| `--dry-run`    | Print the would-be source to stdout instead of writing                                                  |
| `--force`      | Overwrite an existing file at the target path                                                           |
| `--dir <dir>`  | Output directory (default `src/routes`)                                                                 |

### Output shape

The generated file exports `registerRoute(app)`. Wire it into your entry
file once:

```ts
import { registerRoute } from './routes/users-by-id';
registerRoute(app);
```

Subsequent runs against the same path return "already exists" — the
command is idempotent unless you pass `--force`.

## `axiomify migrate`

```bash
axiomify migrate --dry-run     # show the unified diff, write nothing
axiomify migrate --report-only # print a summary report, write nothing
axiomify migrate               # apply changes in-place
axiomify migrate --dir lib     # scan a non-default directory
```

Automated v4 → v5 codemod. Recursively scans `.ts` / `.tsx` / `.js` /
`.mjs` / `.cjs` files under `src/` (or `--dir`) and applies five
mechanical renames:

| Rule | What it does |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `meta-to-schema` | Flags `meta: { ... }` with a TODO comment for manual merge into `schema:` | `meta: {` → `openapi: {` on route definitions |
| `useSwagger-import` | `useSwagger` → `useOpenAPI` |
| `routePrefix-option` | `routePrefix:` → `prefix:` inside `useOpenAPI()` calls |
| `RouteMeta-type` | `RouteMeta` type references → `RouteSchema` | `RouteMeta` type references → `RouteSchema` | `RouteMeta` type references → `RouteSchema` | `RouteMeta` type references → `OpenApiOperation` |
| `AppPlugin-type` | `AppPlugin` type references → `AppConfigurator` |

**What it does NOT do** (flagged in the post-run hint for manual review):

- 5-arg positional `SerializerFn` signatures (function body needs by-hand updates)
- Adding `app.enableRequestId()` (some apps explicitly want it off)
- Strengthening JWT secrets to 32 bytes
- Removing dangling `AppPlugin` / `RouteMeta` import bindings (TypeScript flags these as unused)

The codemod is regex-based, not AST-based — narrow renames make this
safe in practice. For broader / unusual layouts use `--report-only`
then apply by hand.

After migrating, verify with:

```bash
axiomify check
```

## `axiomify doctor`

```bash
axiomify doctor
```

Diagnoses the _host_ environment. Run on a fresh clone or a new CI
runner to confirm the box can actually run Axiomify before chasing test
failures that turn out to be Node-version mismatches.

Checks:

- Node version vs `uWebSockets.js` prebuilt support (22 / 24)
- Platform (Linux ✓; macOS / Windows need `allowUserspaceProxy` for clustering)
- `@axiomify/*` workspace alignment (mixed versions warned)
- `uWebSockets.js` native binding actually loads
- `dist/` exists (recent production build)
- Port 3000 (or `$PORT`) free on `127.0.0.1`

Exit code 0 when no fails, 1 otherwise.

## `axiomify db`

```bash
axiomify db migrate              # run the manifest's migrate command
axiomify db seed
axiomify db generate --dry-run   # print what would run, execute nothing
axiomify db status               # which manifest + commands are configured
```

Runs the project's database workflow through a manifest at the project
root (schema v1, owned by `@axiomify/db`):

- `axiomify.db.json` — plain JSON; commands must be shell strings.
- `axiomify.db.mjs` — ES module; commands may also be functions, ideally
  wrapped in `defineDbConfig()` for editor typing. Requires
  `@axiomify/db` to be installed.

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

### Semantics

- The CLI **never executes anything not explicitly declared in the
  manifest** — no auto-detection of "probably prisma" at run time.
- Shell-string commands are spawned with inherited stdio; the child's
  exit code becomes the CLI's exit code.
- Function commands (`.mjs` manifests) are awaited; a thrown error exits 1.
- `--dry-run` (on `migrate` / `seed` / `generate`) prints the command
  that would run and exits 0 without executing.
- Missing manifest or missing command → clear error with a suggested
  `axiomify.db.json` snippet, exit 1.
- Having **both** manifest files is ambiguous and refused.

### Manifest loading

`@axiomify/db`'s `loadDbConfig()` is imported lazily (dynamic import).
When the package isn't installed, a built-in fallback reads
`axiomify.db.json` with the same v1 validation rules, so the CLI stands
alone for JSON manifests. `.mjs` manifests without the package produce a
clear "install @axiomify/db" error.

### `axiomify db status`

Reports which manifest was found (path + format) and which of
`migrate` / `seed` / `generate` are configured. When **no** manifest
exists, it runs best-effort ORM detection and prints hints plus a
suggested manifest:

- `prisma/schema.prisma` → Prisma (`prisma migrate deploy` / `db seed` / `generate`)
- `drizzle.config.{ts,js,mjs,cjs,mts,cts}` → Drizzle (`drizzle-kit migrate` / `generate`)
- `knexfile.{js,ts,mjs,cjs,mts,cts}` → Knex (`knex migrate:latest` / `seed:run`)

`status` always exits 0 unless the manifest itself is invalid.

## `axiomify sdk`

The `sdk` command suite powers the enterprise Type-Safe SDK Generation Platform. It transforms your backend schemas into fully-typed client SDKs across multiple languages.

### `axiomify sdk generate`

Generates ready-to-use SDKs using our `TypeGraph` AST compiler.

```bash
axiomify sdk generate openapi.json -t typescript       # generate a typescript SDK
axiomify sdk generate schema.graphql -t python go      # multiple languages
axiomify sdk generate src/index.ts -t swift            # parse directly from an Axiomify app
```

#### Flags

| Flag                      | Description                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `-t, --target <langs...>` | **(Required)** Target languages. Supported: `typescript`, `python`, `go`, `swift`, `kotlin`, `dart`. |
| `-o, --output <dir>`      | Output directory (default: `generated-sdks`)                                                         |
| `-n, --name <name>`       | Package name (e.g. `my-api-sdk`)                                                                     |
| `-v, --version <version>` | Package version (e.g. `1.0.0`)                                                                       |
| `--no-runtime`            | Do not include runtime dependencies (generate pure types)                                            |
| `--dry-run`               | Print files to stdout instead of disk                                                                |

_Note: The generated code relies on `@axiomify/sdk-runtime`, a zero-dependency HTTP runtime. See [SDK Runtime](./sdk-runtime.md) for details._

### `axiomify sdk build`

Builds, validates, and checks API schema compile target readiness. It parses your OpenAPI or GraphQL schema and runs it through the compiler pipeline to ensure it can be translated into target SDK languages without any intermediate representation errors.

```bash
axiomify sdk build openapi.json
axiomify sdk build schema.graphql
```

### `axiomify sdk validate`

Performs strict syntactic and semantic validations against your schema by passing it through the SDK `CompilerPipeline`. Ideal for CI sanity checks before pushing a schema registry.

```bash
axiomify sdk validate spec.json
```

### `axiomify sdk diff`

Compares two API schema states to flag breaking changes (e.g., removed endpoints, altered path signatures). This is invaluable in CI/CD pipelines to guarantee backwards compatibility for mobile or external API consumers.

```bash
axiomify sdk diff old-spec.json new-spec.json
```

### `axiomify sdk migrate`

Generates client migration steps and guides between two API schemas. It compares the two schemas, analyzes the differences, and outputs a step-by-step developer migration checklist of actions (e.g., REMOVE or MODIFY) required on the client side.

```bash
axiomify sdk migrate old-spec.json new-spec.json
# Or output as JSON for custom tool integrations:
axiomify sdk migrate old-spec.json new-spec.json --json
```

### `axiomify sdk watch`

Starts a file watcher on the input schema file and automatically triggers the SDK compiler and generators whenever the schema file changes.

```bash
axiomify sdk watch openapi.json -t typescript python -o ./sdks
```

### `axiomify sdk doctor`

Verifies and diagnoses the host system for availability of target toolchains required to compile and build target SDK packages. It checks for:

- Node.js (TypeScript/JavaScript)
- Python 3 (Python)
- Go compiler (Go)
- Dart SDK (Dart)
- Java JDK / Gradle (Kotlin)
- Swift / Xcode command line tools (Swift)

```bash
axiomify sdk doctor
```

### `axiomify sdk benchmark`

Benchmarks the performance of the SDK schema compiler and target generators using a synthesized large API schema with 50 endpoints and 100 object types. Prints compiler and generator throughput metrics (endpoints/sec and files/sec).

```bash
axiomify sdk benchmark
```

### `axiomify sdk publish`

Simulates or executes publishing generated SDK packages to their respective package registries (NPM, PyPI, Go Git repositories, Gradle, CocoaPods, and Dart Pub). Runs in dry-run mode by default.

```bash
axiomify sdk publish
# To perform real publishing and override registry:
axiomify sdk publish --no-dry-run --registry https://my-private-registry.com
```

### `axiomify sdk upgrade`

Checks and upgrades the local target tools and runtime dependency `@axiomify/sdk-runtime` to the latest version.

```bash
axiomify sdk upgrade
# Or preview without making changes:
axiomify sdk upgrade --dry-run
```

## Working with the CLI in CI

A typical CI pipeline that uses the new commands:

```yaml
- name: Environment sanity
  run: npx axiomify doctor

- name: Static production-readiness check
  run: npx axiomify check

- name: Generate spec for client codegen
  run: npx axiomify openapi -o ./openapi.json --spec-version "$GITHUB_SHA"

- name: Validate the spec (official OAS 3.1 schema + lints)
  run: npx axiomify openapi --validate

- name: Guard the route surface against breaking changes
  run: npx axiomify routes --diff routes-baseline.json

- name: Run database migrations (manifest-driven)
  run: npx axiomify db migrate

- name: Build production bundle
  run: npx axiomify build
```

Commit a baseline once with `axiomify routes --snapshot` and the
`--diff` step fails the build on removed routes, method changes, and
request-schema regressions before they reach production (response-schema
changes warn; add `--strict-response` to make them fail too).

## Output

| File                    | Produced by                    | Purpose                                 |
| ----------------------- | ------------------------------ | --------------------------------------- |
| `dist/index.js`         | `axiomify build`               | Production bundle                       |
| `.axiomify/dev.js`      | `axiomify dev`                 | Watch-mode build (auto-cleaned on exit) |
| `.axiomify/inspect.cjs` | `routes` / `openapi` / `check` | Temp inspection bundle (auto-cleaned)   |
| `routes-baseline.json`  | `axiomify routes --snapshot`   | Route-surface baseline for `--diff`     |
