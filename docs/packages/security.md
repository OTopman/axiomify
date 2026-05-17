# @axiomify/security

Defence-in-depth middleware for Axiomify. Sanitises request bodies against
XSS / prototype pollution / null bytes, normalises HTTP parameter
pollution, and blocks scanner User-Agents.

> The SQL-injection regex detector that shipped in 4.x was **removed in
> 5.0.0**. The patterns were trivially bypassable (comment insertion,
> case variation, URL encoding, CASE/WHEN, time-based blind) and produced
> false positives on legitimate JSON containing the strings `union select`
> / `or 1=1`. Parameterised queries at the DB layer are the only real
> defence. Setting `sqlInjectionProtection: true` now logs a warning and
> has no runtime effect.

## Install

```bash
npm install @axiomify/security
```

## Quick start

```typescript
import { useSecurity } from '@axiomify/security';

useSecurity(app); // every protection that's safe-by-default is on
```

Explicit form with every option:

```typescript
useSecurity(app, {
  xssProtection: true,                 // strip XSS patterns from body/query/params
  hppProtection: true,                 // normalise duplicate query params
  prototypePollutionProtection: true,  // drop __proto__ / constructor / prototype keys
  nullByteProtection: true,            // strip null bytes from strings
  botProtection: true,                 // block common scanner User-Agents
  noSqlInjectionProtection: false,     // off by default — narrow Mongo $op check
  maxBodySize: 1_048_576,              // 1 MiB Content-Length guard (NOT a stream limit)
});
```

## Options

| Option | Default | Description |
|---|---|---|
| `xssProtection` | `true` | Strip XSS patterns (`<script>`, `javascript:`, inline event handlers, `<iframe>` / `<svg>` / `<object>`) from body, query, and params. **Heuristic only — see "Important limitations" below.** |
| `hppProtection` | `true` | HTTP Parameter Pollution: collapse duplicate query keys to the *last* value (`?a=1&a=2` → `{a: '2'}`). |
| `prototypePollutionProtection` | `true` | Drop `__proto__`, `constructor`, and `prototype` keys recursively from all input objects. |
| `nullByteProtection` | `true` | Strip null bytes (`\0`) from all string values in body/query/params. |
| `botProtection` | `true` | Reject requests matching known scanner/scraper User-Agents (`sqlmap`, `nikto`, `acunetix`, `nessus`, `nmap`, `masscan`, `zgrab`). |
| `noSqlInjectionProtection` | `false` | Narrow Mongo-style operator-key check. Off by default; opt in only as a defence-in-depth supplement to schema validation — see "Important limitations". |
| `maxBodySize` | `1048576` | Reject requests whose `Content-Length` header exceeds this value. ⚠️ Chunked transfer bypasses this — enforce limits at the adapter layer too. |
| `blockedUserAgentPatterns` | built-in | Override the default scanner UA regex list. |
| `noSqlPatterns` | built-in | Override the NoSQL operator regex list. |
| `sanitizerMaxDepth` | `64` | Maximum depth for recursive input sanitisation (prevents stack overflow attacks via deeply nested JSON). |
| ~~`sqlInjectionProtection`~~ | `false` (no-op) | **Removed in 5.0.0.** Setting `true` now warns and has no effect. See banner above. |
| ~~`sqlPatterns`~~ | — | **Removed in 5.0.0.** No longer used. |

## Important limitations

```
⚠️ The XSS sanitiser is a defence-in-depth helper, NOT a primary control.
   Regex-based HTML stripping is bypassable via mutation XSS, SVG injection,
   CSS injection, and many other vectors. For production apps that render
   user-supplied content, use a dedicated HTML sanitiser (DOMPurify via
   jsdom, `sanitize-html`) that operates on a real HTML parser.

⚠️ The NoSQL operator detector catches the narrow case where an attacker
   passes `{"username": {"$ne": null}}` as a JSON value that would
   otherwise be a primitive. It does NOT catch logic injection, NoSQL
   schema attacks, or anything more sophisticated. The REAL defence is
   Zod schema validation that rejects unexpected object shapes before
   they reach the driver. Off by default.

⚠️ maxBodySize checks Content-Length, which clients control.
   A chunked-transfer request can omit Content-Length entirely and stream
   any amount of data past this check. Always set `maxBodySize` on the
   NativeAdapter as well — the adapter enforces it on the actual byte
   stream, not the header.

⚠️ botProtection only blocks User-Agents matching known patterns.
   A sophisticated attacker will spoof a legitimate UA. Treat this as a
   noise filter, not a gate.
```

## Combining with adapter-level limits

```typescript
const adapter = new NativeAdapter(app, { maxBodySize: 1_048_576 }); // authoritative

useSecurity(app, { maxBodySize: 1_048_576 }); // belt-and-braces; checks Content-Length
```

## How input is sanitised

`useSecurity` reassigns `req.body`, `req.query`, and `req.params` after
sanitisation using **direct property assignment** — not
`Object.defineProperty`. Direct assignment preserves V8's hidden-class
optimisation on the request object, keeping subsequent property accesses
on the fast inline-cache path.

The XSS sanitiser uses a "replace-until-stable" loop (CWE-20 / CWE-80
mitigation) so multi-character bypass patterns like
`<scrip<script>t>alert(1)</script>` don't survive a single-pass regex.
