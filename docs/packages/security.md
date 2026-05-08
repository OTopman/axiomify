# @axiomify/security

Security hardening middleware for Axiomify. Protects against XSS, SQL/NoSQL injection, HPP,
prototype pollution, null bytes, and common bot patterns.

## Install

```bash
npm install @axiomify/security
```

## Quick start

```typescript
import { useSecurity } from '@axiomify/security';

useSecurity(app, {
  xssProtection: true,              // strip XSS patterns from body/query/params
  hppProtection: true,              // normalise duplicate query params
  sqlInjectionProtection: true,     // heuristic SQL pattern detection
  noSqlInjectionProtection: true,   // heuristic NoSQL pattern detection
  prototypePollutionProtection: true, // strip __proto__, constructor, prototype keys
  nullByteProtection: true,          // block null bytes in all input
  botProtection: true,               // block common scanner/scraper User-Agents
  maxBodySize: 1_048_576,           // 1 MB Content-Length guard (not chunked encoding)
});
```

## Options

| Option | Default | Description |
|---|---|---|
| `xssProtection` | `true` | Strip XSS patterns (`<script>`, JS URIs, event handlers) from body, query, and params. |
| `hppProtection` | `true` | HTTP Parameter Pollution: collapse duplicate query params to the last value. |
| `maxBodySize` | `1048576` | Reject requests whose `Content-Length` header exceeds this value. ⚠️ Chunked transfer bypasses this — enforce limits at the adapter layer too. |
| `sqlInjectionProtection` | `true` | Heuristic pattern match on request body/query/params. ⚠️ Not a complete defense — use parameterized queries. |
| `noSqlInjectionProtection` | `true` | Block operator-injection patterns (`$where`, `$gt`, etc.). ⚠️ Not a complete defense — use Zod schema validation. |
| `prototypePollutionProtection` | `true` | Strip `__proto__`, `constructor`, `prototype` keys from all input objects. |
| `nullByteProtection` | `true` | Reject requests containing null bytes (`\0`). |
| `botProtection` | `true` | Block requests matching known scanner/scraper User-Agent patterns. |
| `blockedUserAgentPatterns` | built-in | Override the default blocked UA regex list. |
| `sqlPatterns` | built-in | Override the SQL injection regex list. |
| `noSqlPatterns` | built-in | Override the NoSQL injection regex list. |
| `sanitizerMaxDepth` | `64` | Maximum depth for recursive input sanitization (prevents stack overflow attacks). |

## Important limitations

```
⚠️ SQL injection heuristics are NOT a reliable defense.
   Parameterized queries (Prisma, pg-safe-query) are the only real protection.

⚠️ maxBodySize checks Content-Length, which clients control.
   A chunked-transfer request can omit Content-Length entirely and stream any amount of data.
   Always set bodyLimitBytes on the adapter (ExpressAdapter, FastifyAdapter, etc.) as well.

⚠️ botProtection only blocks User-Agents matching known patterns.
   A sophisticated attacker will spoof a legitimate UA.
```

## Combining with adapter-level limits

```typescript
// Adapter: enforce body size on the actual stream (not just Content-Length header)
const adapter = new FastifyAdapter(app, { bodyLimit: 1_048_576 });
const expressAdapter = new ExpressAdapter(app, { bodyLimit: '1mb' });

// Plugin: additional heuristic checks on parsed content
useSecurity(app, { maxBodySize: 1_048_576 });
```

## How input is sanitized

`useSecurity` reassigns `req.body`, `req.query`, and `req.params` after sanitization using
**direct property assignment** — not `Object.defineProperty`. Direct assignment preserves
V8's hidden-class optimization on the request object, keeping subsequent property accesses fast.
