# @axiomify/cors

Framework-agnostic CORS middleware for Axiomify.

## Install

```bash
npm install @axiomify/cors
```

## Usage

```ts
import { useCors } from '@axiomify/cors';

useCors(app, {
  origin: ['https://app.example.com'],
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
  strictPreflight: true,
  allowPrivateNetwork: true,
});
```

## Options

- `origin?: boolean | string | RegExp | Array<string | RegExp> | ((origin) => boolean | Promise<boolean>)`
- `methods?: string[]` (default includes `HEAD`)
- `allowedHeaders?: string[]`
- `exposedHeaders?: string[]`
- `credentials?: boolean`
- `maxAge?: number`
- `preflightContinue?: boolean`
- `optionsSuccessStatus?: number`
- `allowPrivateNetwork?: boolean`
- `varyOnRequestHeaders?: boolean`
- `strictPreflight?: boolean`

## Behavior notes

- Throws if `credentials: true` is combined with `origin: '*'`
- Handles OPTIONS preflight automatically
- Merges `Vary` values (`Origin` and `Access-Control-Request-Headers`) safely
- Reflects request headers for `Access-Control-Allow-Headers` when `allowedHeaders` is not provided
