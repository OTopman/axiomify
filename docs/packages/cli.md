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

| Command | Purpose |
|---|---|
| `axiomify init [directory]` | Bootstrap a new project |
| `axiomify dev [entry]` | Dev server with hot-reload |
| `axiomify build [entry]` | Compile a production bundle |
| `axiomify routes [entry]` | Inspect every registered HTTP + WebSocket route |
| `axiomify openapi [entry]` | Generate the OpenAPI spec to stdout or file |
| `axiomify check [entry]` | Static production-readiness audit |
| `axiomify doctor` | Diagnose the host environment |
| `axiomify scaffold route <method> <path>` | Generate a new route file under `src/routes/` |
| `axiomify migrate` | v4 → v5 codemod (rename `meta`→`openapi`, `useSwagger`→`useOpenAPI`, etc.) |

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
```

esbuild watch mode. Spawns the bundled file as a Node child process,
restarting on every successful rebuild. SIGTERM is sent first (so the
user's `gracefulShutdown` hooks can drain), with a SIGKILL fallback after
3 seconds.

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

Inspects the user's app *without* booting a listener and prints a
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

| Flag | Description |
|---|---|
| `--json` | Emit machine-readable JSON instead of the table — pipe into `jq` for tooling |
| `-m, --method <list>` | Comma-separated method filter: `--method GET,POST,WS` |
| `-f, --filter <pattern>` | Path filter — substring match or glob with `*`: `--filter "/api/v1/*"` |
| `-s, --sort <by>` | `path` (default) or `method` |

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

Generates the OpenAPI 3.0.3 spec from the app and emits it. Useful in CI
for client codegen (`openapi-typescript`, `openapi-generator`,
`oazapfts`) without booting an HTTP listener.

### Flags

| Flag | Description |
|---|---|
| `-o, --output <file>` | Write to this file path instead of stdout |
| `--format <fmt>` | `json` (default) or `yaml` |
| `--minify` | Single-line JSON (ignored for yaml) |
| `--title <title>` | Override `info.title` in the generated spec |
| `--spec-version <version>` | Override `info.version` |

> `--spec-version` is named that way (rather than `--version`) to avoid
> colliding with `commander`'s global `--version` flag.

Requires `@axiomify/openapi` to be installed in the target project. The
CLI imports it dynamically and prints a clean error if it's missing.

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

| Flag | Description |
|---|---|
| `--auth` | Include `requireAuth` plugin and the corresponding import |
| `--rate-limit` | Include a default `createRateLimitPlugin` with `MemoryStore` (replace with `RedisStore` for production) |
| `--dry-run` | Print the would-be source to stdout instead of writing |
| `--force` | Overwrite an existing file at the target path |
| `--dir <dir>` | Output directory (default `src/routes`) |

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
|---|---|
| `meta-to-schema` | Flags `meta: { ... }` with a TODO comment for manual merge into `schema:` | `meta: {` → `openapi: {` on route definitions |
| `useSwagger-import` | `useSwagger` → `useOpenAPI` |
| `routePrefix-option` | `routePrefix:` → `prefix:` inside `useOpenAPI()` calls |
| `RouteMeta-type` | `RouteMeta` type references → `RouteSchema` | `RouteMeta` type references → `RouteSchema` | `RouteMeta` type references → `OpenApiOperation` |
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

Diagnoses the *host* environment. Run on a fresh clone or a new CI
runner to confirm the box can actually run Axiomify before chasing test
failures that turn out to be Node-version mismatches.

Checks:

- Node version vs `uWebSockets.js` prebuilt support (18 / 20 / 21 / 22)
- Platform (Linux ✓; macOS / Windows need `allowUserspaceProxy` for clustering)
- `@axiomify/*` workspace alignment (mixed versions warned)
- `uWebSockets.js` native binding actually loads
- `dist/` exists (recent production build)
- Port 3000 (or `$PORT`) free on `127.0.0.1`

Exit code 0 when no fails, 1 otherwise.

## Working with the CLI in CI

A typical CI pipeline that uses the new commands:

```yaml
- name: Environment sanity
  run: npx axiomify doctor

- name: Static production-readiness check
  run: npx axiomify check

- name: Generate spec for client codegen
  run: npx axiomify openapi -o ./openapi.json --spec-version "$GITHUB_SHA"

- name: Build production bundle
  run: npx axiomify build

- name: Snapshot route surface
  run: npx axiomify routes --json > routes.json
```

`routes --json` is particularly useful as a snapshot test — diff
`routes.json` between two commits to detect accidental API changes
(removed routes, method changes, schema regressions) before they reach
production.

## Output

| File | Produced by | Purpose |
|---|---|---|
| `dist/index.js` | `axiomify build` | Production bundle |
| `.axiomify/dev.js` | `axiomify dev` | Watch-mode build (auto-cleaned on exit) |
| `.axiomify/inspect.cjs` | `routes` / `openapi` / `check` | Temp inspection bundle (auto-cleaned) |
