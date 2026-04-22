# @axiomify/security

Composed security middleware for Axiomify apps.

## Install

```bash
npm install @axiomify/security
```

## Usage

```ts
import { useSecurity } from '@axiomify/security';

useSecurity(app, {
  maxBodySize: 1024 * 1024,
  sqlInjectionProtection: true,
  noSqlInjectionProtection: true,
  hppProtection: true,
  prototypePollutionProtection: true,
  nullByteProtection: true,
  botProtection: true,
});
```

## Options

- `xssProtection?: boolean`
- `hppProtection?: boolean`
- `maxBodySize?: number`
- `sqlInjectionProtection?: boolean`
- `noSqlInjectionProtection?: boolean`
- `prototypePollutionProtection?: boolean`
- `nullByteProtection?: boolean`
- `botProtection?: boolean`
- `blockedUserAgentPatterns?: RegExp[]`
- `sqlPatterns?: RegExp[]`
- `noSqlPatterns?: RegExp[]`
