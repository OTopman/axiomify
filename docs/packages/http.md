# @axiomify/http

The native Node.js HTTP adapter.

## Install

```bash
npm install @axiomify/http @axiomify/core zod
```

## Export

- `new HttpAdapter(app, options?)`

## Options

- `bodyLimitBytes`

## Usage

```ts
import { HttpAdapter } from '@axiomify/http';

const adapter = new HttpAdapter(app, {
  bodyLimitBytes: 1_048_576,
});

adapter.listen(3000);
```

## Notes

- smallest runtime surface
- supports streaming and SSE directly
- sanitizes parsed JSON bodies against prototype pollution keys
