# @axiomify/studio-ui

This package contains the front-end source code for the **Axiomify Studio** dashboard — the premium visual control plane and developer companion dashboard for the Axiomify framework.

## Features

- **Route Inspector**: Search, filter, and inspect registered HTTP routes and WebSocket rooms.
- **Schema Inspector**: Browse and inspect JSON schemas compiled from Zod validators.
- **OpenAPI Spec Viewer**: Interactive, tree-structured viewer for OpenAPI operations.
- **Lifecycle Hooks**: Review registered hook handlers across request lifecycle phases.
- **Health Dashboard**: Inspect production-readiness finding audits.
- **Request Tester**: Interactive console with an embedded Monaco editor to construct, send, and analyze test HTTP requests against your live Axiomify application.
- **Operational tooling**: Inspect logs, errors, metrics, traces, profiling,
  performance, background jobs, contracts, SDK impact, and security findings.
- **Traffic workflows**: Record and replay traffic, manage request collections
  and environments, and inspect WebSocket activity.

## Tech Stack

- **React 19** for UI component architecture.
- **Vite** for fast HMR and compilation.
- **Native WebSocket** for real-time Live Sync — connects to the CLI's
  `/__studio/ws` endpoint to receive file-change and data-update events.
- **Socket.io Client** (`socket.io-client`) — used by the Request Tester
  to connect to Socket.io rooms in your running Axiomify application.
- **Monaco Editor** (`@monaco-editor/react`) for structured JSON input payload editing.

## Development

Run the development server:

```bash
npm run dev
```

Build the production bundle. Output is emitted to `../cli/ui-dist` (see
`vite.config.ts`), which the `@axiomify/cli` package ships and serves via
the `axiomify studio` command:

```bash
npm run build
```

The CLI validates that every content-hashed JavaScript and CSS asset referenced
by `ui-dist/index.html` exists. A stale or incomplete bundle displays a rebuild
message instead of serving HTML for a missing module request.

The `build` script runs `tsc -b` before `vite build`. Additional scripts:
`npm run lint` (ESLint) and `npm run preview` (preview the built bundle).
