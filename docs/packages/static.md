# @axiomify/static

Static file serving from an Axiomify app.

## Install

```bash
npm install @axiomify/static
```

## Export

- `serveStatic(app, options)`

## Options

- `prefix`
- `root`

`root` should be an absolute path or a path you resolve intentionally.

## Example

```ts
import path from 'path';
import { serveStatic } from '@axiomify/static';

serveStatic(app, {
  prefix: '/assets',
  root: path.join(process.cwd(), 'public'),
});
```

## Behavior

- registers a wildcard `GET` route
- streams file contents
- emits ETags
- supports `304 Not Modified`
- blocks path traversal outside the configured root
