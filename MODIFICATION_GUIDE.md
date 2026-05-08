# Axiomify Security & CLI Update Guide

This guide details the changes made to the Axiomify framework to harden security, expand CLI capabilities, and improve logging.

## 1. Security Hardening

### @axiomify/security (New Package)
A dedicated package for request-level security.
- **XSS Protection**: Automatically sanitizes `body`, `query`, and `params` using `xss`.
- **SQL Injection Detection**: Basic heuristic detection for common SQLi patterns.
- **Parameter Pollution (HPP)**: Prevents multiple parameters with the same name from being used to bypass filters.
- **Payload Limit**: Configurable `maxBodySize` to prevent DoS attacks.

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
- **Maskify-ts v4**: Upgraded to the latest version for better performance and masking.
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
  removeHeaders: ['X-Powered-By', 'Server', 'X-Custom-Header']
});

useSecurity(app, {
  maxBodySize: 1024 * 1024, // 1MB
  sqlInjectionProtection: true
});

useFingerprint(app, {
  salt: process.env.FINGERPRINT_SALT
});

useLogger(app, {
  beautify: true
});
```

## Running Tests
Each new feature comes with a test suite:
```bash
npm test packages/security
npm test packages/fingerprint
npm test packages/helmet
```
