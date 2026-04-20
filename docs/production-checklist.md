# Production Checklist

Use this checklist before calling an Axiomify application production-ready.

## Core App

- pin a specific Axiomify version
- choose one adapter and test it end-to-end in your deployment environment
- define response schemas for important endpoints
- set route-level timeouts where handlers depend on remote services

## Security

- use `createAuthPlugin(...)` for protected routes
- use `useHelmet(app)` unless you have a reason not to
- configure `useCors(app, ...)` explicitly for browser-facing apps
- keep secrets in environment variables, not source files

## Operations

- add health endpoints with `app.healthCheck(...)`
- install metrics with `useMetrics(app, ...)`
- install structured logging with `useLogger(app, ...)`
- verify shutdown behavior in your process manager or container runtime

## File and WebSocket Workloads

- use `useUpload(app)` only with routes that define `schema.files`
- set sensible file limits in route schemas
- set `maxMessageBytes` and authentication for WebSockets

## Verification

- run the full test suite in CI on a runner that can bind local ports
- run adapter integration tests, not only unit tests
- build every published package before release
