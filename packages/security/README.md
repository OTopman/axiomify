# @axiomify/security

Composed security middleware for Axiomify apps.

This package now composes two lower-level packages for simpler maintenance:

- `@axiomify/security-detector` (attack pattern and user-agent detection)
- `@axiomify/security-sanitizer` (XSS/null-byte/prototype + HPP helpers)

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
