# @axiomify/hapi

Hapi adapter for Axiomify.

## Install

```bash
npm install @axiomify/hapi @axiomify/core @hapi/hapi zod
```

## Export

- `new HapiAdapter(app, config?)`

## Usage

```ts
import { HapiAdapter } from '@axiomify/hapi';

const adapter = new HapiAdapter(app, {
  host: 'localhost',
});

await adapter.listen(3000);
```

## Notes

- constructor accepts Hapi server options
- parses non-multipart request bodies before handing control to the core engine
- keeps multipart requests streaming-friendly for `@axiomify/upload`
