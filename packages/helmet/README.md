# @axiomify/helmet

Configurable HTTP security headers for defense-in-depth. Automatically sets HSTS, CSP, X-Frame-Options, and other protective headers.

## Installation

```bash
npm install @axiomify/helmet
```

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { useHelmet } from '@axiomify/helmet';

const app = new Axiomify();

// Use default security headers
useHelmet(app);

// All responses now include security headers
```

## Features

- **Default Security Posture**: Enables HSTS, disables MIME sniffing, enables XSS filtering by default
- **Configurable**: Override any header with custom values
- **Zero Breaking Changes**: All v3.x configurations remain compatible
- **Lightweight**: No external dependencies

## API Reference

### `useHelmet(app, options?)`

Registers security headers on the app.

**Options (all optional):**

```typescript
interface HelmetOptions {
  // Strict-Transport-Security: enforce HTTPS
  hsts?: {
    maxAge?: number;           // Seconds (default: 31536000 = 1 year)
    includeSubDomains?: boolean; // default: true
    preload?: boolean;         // default: false
  } | false;
  
  // X-Content-Type-Options: prevent MIME sniffing
  noSniff?: boolean; // default: true
  
  // X-Frame-Options: prevent clickjacking
  frameguard?: {
    action?: 'DENY' | 'SAMEORIGIN'; // default: 'DENY'
  } | false;
  
  // X-XSS-Protection: enable browser XSS filters (legacy)
  xssFilter?: boolean; // default: true
  
  // Content-Security-Policy
  contentSecurityPolicy?: {
    directives?: Record<string, string[]>;
  } | false;
  
  // Other headers
  referrerPolicy?: { policy?: string } | false;
  permissionsPolicy?: Record<string, string[]> | false;
}
```

## Examples

### Strict Security (Default)

```typescript
useHelmet(app);
// Applies all defaults: HSTS, noSniff, frameguard, xssFilter
```

### Custom CSP Policy

```typescript
useHelmet(app, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'cdn.example.com'],
      styleSrc: ["'self'", 'fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.example.com'],
    },
  },
});
```

### HSTS with Preload

```typescript
useHelmet(app, {
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true, // Include in HSTS preload lists
  },
});
```

### Allow Iframes on Same Origin

```typescript
useHelmet(app, {
  frameguard: {
    action: 'SAMEORIGIN', // Allow framing from same origin
  },
});
```

### Disable Specific Headers

```typescript
useHelmet(app, {
  noSniff: false,    // Allow MIME sniffing
  xssFilter: false,  // Disable XSS filter
  hsts: false,       // Disable HSTS
});
```

## Common Configurations

### Maximum Security (Production)

```typescript
useHelmet(app, {
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  frameguard: { action: 'DENY' },
  referrerPolicy: { policy: 'no-referrer' },
});
```

### Relaxed Security (Development)

```typescript
useHelmet(app, {
  hsts: false,
  contentSecurityPolicy: false,
  frameguard: false,
});
```

### API Server (No CSP Needed)

```typescript
useHelmet(app, {
  hsts: { maxAge: 31536000 },
  contentSecurityPolicy: false, // APIs don't need CSP
  frameguard: { action: 'DENY' },
});
```

## Header Reference

| Header | Purpose | Default |
| --- | --- | --- |
| `Strict-Transport-Security` | Force HTTPS connections | Enabled (1 year) |
| `X-Content-Type-Options` | Prevent MIME sniffing attacks | `nosniff` |
| `X-Frame-Options` | Prevent clickjacking | `DENY` |
| `X-XSS-Protection` | Enable browser XSS filters | Enabled |
| `Content-Security-Policy` | Restrict content origins | Not set (app-specific) |
| `Referrer-Policy` | Control referrer information | Not set (browser default) |
| `Permissions-Policy` | Control browser APIs | Not set (browser default) |

## CSP Directives

Common `Content-Security-Policy` directives:

- `default-src` — fallback for all fetch directives
- `script-src` — JavaScript sources
- `style-src` — CSS sources
- `img-src` — Image sources
- `font-src` — Font sources
- `connect-src` — Fetch/XHR/WebSocket/EventSource origins
- `media-src` — `<audio>` and `<video>` sources
- `object-src` — `<object>`, `<embed>`, `<applet>` sources
- `frame-src` — `<frame>` and `<iframe>` sources
- `worker-src` — Web Worker and SharedWorker sources

Values:
- `'self'` — Same origin as the document
- `'unsafe-inline'` — Allow inline scripts/styles (not recommended)
- `'unsafe-eval'` — Allow `eval()` (not recommended)
- `'none'` — Disallow entirely
- `data:` — Allow data: URLs
- `https:` — Allow all HTTPS origins
- `https://example.com` — Specific origin

## Testing

```typescript
it('sets strict HSTS header', async () => {
  const res = await fetch('http://localhost:3000/');
  expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
});

it('sets CSP header with custom directives', async () => {
  const res = await fetch('http://localhost:3000/');
  const csp = res.headers.get('Content-Security-Policy');
  expect(csp).toContain("default-src 'self'");
});
```

## Browser Support

- HSTS: All modern browsers, IE 11+
- X-Content-Type-Options: All modern browsers, IE 8+
- X-Frame-Options: All modern browsers, IE 8+
- X-XSS-Protection: Mostly deprecated (use CSP instead), but still useful as a fallback
- CSP: All modern browsers, IE 11+ (with limitations)

## Migration from v3.x

No breaking changes. If you were using helmet via a separate package, switch to `@axiomify/helmet` for integration:

```typescript
// ❌ Before
import helmet from 'helmet';
fastifyInstance.register(helmet);

// ✅ After
import { useHelmet } from '@axiomify/helmet';
useHelmet(app);
```

## License

MIT