# @axiomify/security

Security hardening middleware for Axiomify apps.

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

## Main protections

- Request body size guard via `content-length`
- SQL / NoSQL payload heuristics
- HTTP parameter pollution normalization
- XSS sanitization of body/query/params
- Prototype pollution key stripping
- Null-byte sanitization
- Suspicious scanner user-agent blocking

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
