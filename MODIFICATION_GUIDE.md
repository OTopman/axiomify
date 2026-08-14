# Axiomify Security & CLI Update Guide

This document records substantive feature additions to the Axiomify framework. For the canonical version-by-version changelog see [CHANGELOG.md](./CHANGELOG.md); this guide focuses on conceptual changes and how to use them.

## 1. Security Hardening

### @axiomify/security

A dedicated package for request-level security.

- **XSS Protection**: Built-in recursive sanitiser strips `<script>`, `javascript:` / `data:` URIs, inline event handlers, and unsafe tags (`<iframe>`, `<svg>`, `<object>`, `<embed>`, `<base>`) from string values in `body`, `query`, and `params`. Uses a "replace-until-stable" loop so multi-character bypass patterns don't survive a single pass. Note: this is defence-in-depth — for rendering user-supplied HTML, use a dedicated HTML sanitiser (DOMPurify) on a real parser.
- **Parameter Pollution (HPP)**: Collapses repeated query keys to the last value (`?a=1&a=2` → `{a: '2'}`).
- **Prototype Pollution**: Drops `__proto__`, `constructor`, `prototype` keys recursively.
- **Null bytes**: Stripped from string values by default.
- **Bot UA detection**: Blocks scanner User-Agents (`sqlmap`, `nikto`, `acunetix`, `nessus`, `nmap`, `masscan`, `zgrab`).
- **Narrow NoSQL operator check** (opt-in): Catches `{"username": {"$ne": null}}`-style operator injection. Off by default.
- **Payload limit (`maxBodySize`)**: Checks `Content-Length`. Belt-and-braces with the adapter-level limit, which enforces on the actual byte stream.

> The regex-based SQL injection detector that shipped in 4.x was **removed in 5.0**. The patterns were trivially bypassable (comment insertion, case variation, URL encoding) and produced false positives on legitimate JSON. Parameterised queries at the DB layer are the only real defence. Setting `sqlInjectionProtection: true` now warns and has no runtime effect.

### @axiomify/helmet (Updated)

Expanded to include more security headers and header removal.

- **Sensitive Header Removal**: Automatically removes `X-Powered-By` and `Server`.
- **HSTS**: Now supports detailed configuration (preload, subdomains).
- **Referrer Policy & Permissions Policy**: Added standard production defaults.

### @axiomify/cors (Updated)

- **Dynamic Origins**: Supports `RegExp` and `Function` based origin matching.
- **Preflight Control**: Better handling of `OPTIONS` requests and preflight caching.

## 2. Client Fingerprinting

### @axiomify/fingerprint (New Package)

A production-grade fingerprinting utility.

- **Accuracy**: Combines IP, User-Agent, and multiple `Sec-CH-*` headers for high entropy.
- **Security**: Supports custom `salt` and `algorithm` (default SHA-256).
- **Usage**: Fingerprint is automatically attached to `req.state.fingerprint`.

## 3. CLI Enhancements

### Interactive Initialization

The `axiomify init` command is now interactive:

- **Project Name**: Prompted if not provided as an argument.
- **Dependency Installation**: Option to run `npm install` automatically.
- **Standard Practices**: Option to add **ESLint** and **Prettier** with production-ready configs.
- **Scaffold**: Includes security packages by default in the generated `src/index.ts`.

## 4. Logger Update

### @axiomify/logger (Updated)

- **PII masking**: Uses `maskify-ts` for recursive, customizable PII masking across request/response metadata, headers, bodies, and payloads.
- **Beautification**: Added colored, formatted console output for development.
- **Request Details**: Logs method, path, status codes (with colors), and request duration.

## How to use the new features

```typescript
import { Axiomify } from '@axiomify/core';
import { useSecurity } from '@axiomify/security';
import { useHelmet } from '@axiomify/helmet';
import { useFingerprint } from '@axiomify/fingerprint';
import { useLogger } from '@axiomify/logger';

const app = new Axiomify();

// Apply hardening
useHelmet(app, {
  removeHeaders: ['X-Powered-By', 'Server', 'X-Custom-Header'],
});

useSecurity(app, {
  maxBodySize: 1024 * 1024, // 1MB Content-Length guard (NOT a stream limit)
  // sqlInjectionProtection was removed in 5.0 — see banner above.
  // Use parameterised queries at the DB layer for real SQLi defence.
  noSqlInjectionProtection: true, // narrow Mongo $op check; off by default
});

useFingerprint(app, {
  salt: process.env.FINGERPRINT_SALT,
});

useLogger(app, {
  beautify: true,
});
```

## Running Tests

Each new feature comes with a test suite:

```bash
npm test packages/security
npm test packages/fingerprint
npm test packages/helmet
```
