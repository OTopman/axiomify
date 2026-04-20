# @axiomify/express

Express adapter for Axiomify.

## Install

```bash
npm install @axiomify/express @axiomify/core express zod
```

## Export

- `new ExpressAdapter(app)`

## Usage

```ts
import { ExpressAdapter } from '@axiomify/express';

const adapter = new ExpressAdapter(app);
adapter.listen(3000);
```

## Notes

- internally owns an Express app instance
- exposes it as `adapter.native`
- parses JSON and URL-encoded bodies only when a route exists
