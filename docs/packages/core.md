# @axiomify/core

The framework-agnostic engine behind Axiomify.

## Install

```bash
npm install @axiomify/core zod
```

## Main Surface

- `new Axiomify(options?)`
- `app.route(...)`
- `app.addHook(...)`
- `app.group(...)`
- `app.healthCheck(...)`
- `app.setSerializer(...)`
- `app.use(...)`

## What Lives Here

- route registration and lookup
- validation compilation and execution
- lifecycle hooks
- route plugin execution
- shared request and response contracts

## Best Used With

Pair `@axiomify/core` with one adapter package:

- `@axiomify/express`
- `@axiomify/fastify`
- `@axiomify/hapi`
- `@axiomify/http`
