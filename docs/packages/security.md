# @axiomify/security

Security hardening middleware for Axiomify.

Built on top of:
- `@axiomify/detector`
- `@axiomify/sanitizer`

## Install

```bash
npm install @axiomify/security
```

## Export

- `useSecurity(app, options?)`

## Options

- `xssProtection`
- `hppProtection`
- `maxBodySize`
- `sqlInjectionProtection`
- `noSqlInjectionProtection`
- `prototypePollutionProtection`
- `nullByteProtection`
- `botProtection`
- `blockedUserAgentPatterns`

## Example

```ts
import { useSecurity } from '@axiomify/security';

useSecurity(app, {
  maxBodySize: 1024 * 1024,
  sqlInjectionProtection: true,
  noSqlInjectionProtection: true,
  botProtection: true,
});
```

## Behavior

- blocks oversized requests
- detects SQL/NoSQL attack signatures
- sanitizes XSS and null bytes
- mitigates query parameter pollution
- strips prototype pollution keys
- blocks known scanner user agents
