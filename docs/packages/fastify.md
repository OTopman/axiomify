# @axiomify/fastify

Fastify adapter for throughput-oriented deployments.

## Install

```bash
npm install @axiomify/fastify @axiomify/core fastify zod
```

## Export

- `new FastifyAdapter(app)`

## Usage

```ts
import { FastifyAdapter } from '@axiomify/fastify';

const adapter = new FastifyAdapter(app);
adapter.listen(3000);
```

## Notes

- adds multipart parser support for upload flows
- sanitizes parsed JSON bodies against prototype pollution keys
- uses Fastify as the runtime while keeping the same core routes
