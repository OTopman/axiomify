# Adapters

Adapters let the same `Axiomify` app run in different server environments.

## Choose an Adapter

- `@axiomify/fastify`: best throughput-first default
- `@axiomify/express`: easiest migration from existing Express apps
- `@axiomify/hapi`: useful for Hapi-centric environments
- `@axiomify/http`: smallest surface and no framework dependency

## Shared Pattern

Every adapter is created from an `Axiomify` instance:

```ts
const app = new Axiomify();
// register routes
const adapter = new SomeAdapter(app);
adapter.listen(3000);
```

## Express

```ts
import { ExpressAdapter } from '@axiomify/express';

const adapter = new ExpressAdapter(app);
adapter.listen(3000);
```

Use `adapter.native` if you need access to the underlying Express app.

## Fastify

```ts
import { FastifyAdapter } from '@axiomify/fastify';

const adapter = new FastifyAdapter(app);
adapter.listen(3000);
```

The adapter installs multipart handling compatible with `@axiomify/upload`.

## Hapi

```ts
import { HapiAdapter } from '@axiomify/hapi';

const adapter = new HapiAdapter(app, {
  port: 3000,
  host: 'localhost',
});

await adapter.listen();
```

The adapter constructor accepts Hapi server options.

## Native HTTP

```ts
import { HttpAdapter } from '@axiomify/http';

const adapter = new HttpAdapter(app, {
  bodyLimitBytes: 1_048_576,
});

adapter.listen(3000);
```

Use this when you want the lightest runtime and no framework dependency.
