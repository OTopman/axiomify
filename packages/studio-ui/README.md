# @axiomify/studio-ui

This package contains the front-end source code for the **Axiomify Studio** dashboard — the premium visual control plane and developer companion dashboard for the Axiomify framework.

## Features

- **Route Inspector**: Search, filter, and inspect registered HTTP routes and WebSocket rooms.
- **Schema Inspector**: Browse and inspect JSON schemas compiled from Zod validators.
- **OpenAPI Spec Viewer**: Interactive, tree-structured viewer for OpenAPI operations.
- **Lifecycle Hooks**: Review registered hook handlers across request lifecycle phases.
- **Health Dashboard**: Inspect production-readiness finding audits.
- **Request Tester**: Interactive console with an embedded Monaco editor to construct, send, and analyze test HTTP requests against your live Axiomify application.

## Tech Stack

- **React 19** for UI component architecture.
- **Vite** for fast HMR and compilation.
- **Socket.io Client** for real-time live synchronization and file-change updates.
- **Monaco Editor** (`@monaco-editor/react`) for structured JSON input payload editing.

## Development

Run the development server:
```bash
npm run dev
```

Build the production bundle (emitted to the package distribution target, which is served by the CLI's `axiomify studio` command):
```bash
npm run build
```
