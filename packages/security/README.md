# @axiomify/security

Request security hardening for Axiomify. XSS sanitization, HTTP Parameter Pollution protection, prototype pollution prevention, null-byte blocking, SQL/NoSQL injection heuristics, and bot detection.

## Install

```bash
npm install @axiomify/security
```

## Quick start

```typescript
import { useSecurity } from '@axiomify/security';
useSecurity(app);
```

All protections are enabled by default.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `xssProtection` | `boolean` | `true` | Strip `<script>`, event handlers, `javascript:` from strings |
| `hppProtection` | `boolean` | `true` | Deduplicate repeated query params (last value wins) |
| `prototypePollutionProtection` | `boolean` | `true` | Remove `__proto__`, `constructor`, `prototype` keys |
| `nullByteProtection` | `boolean` | `true` | Remove null bytes (`\0`) from strings |
| `botProtection` | `boolean` | `true` | Block known scanner/crawler User-Agent patterns |
| `sqlInjectionProtection` | `boolean` | `true` | Heuristic SQL pattern detection |
| `noSqlInjectionProtection` | `boolean` | `true` | Heuristic NoSQL pattern detection |
| `maxBodySize` | `number` | `1048576` | Reject requests where Content-Length exceeds this value |

## Caveats

- SQL/NoSQL injection detection is heuristic — not a replacement for parameterized queries.
- `maxBodySize` checks `Content-Length` header only. Enforce stream limits at the adapter level too.
- Bot patterns target known scanners; a custom `blockedUserAgentPatterns` array covers bespoke cases.

## Performance

Body sanitization uses direct property assignment (not `Object.defineProperty`) — V8 hidden-class optimisation is preserved.
