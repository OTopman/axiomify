# @axiomify/cors

Framework-agnostic CORS middleware with automatic `OPTIONS` preflight handling, strict validation, and proper cache headers.

## Installation

```bash
npm install @axiomify/cors
```

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { useCors } from '@axiomify/cors';

const app = new Axiomify();

// Allow requests from a specific origin
useCors(app, {
  origin: 'https://trusted.example.com',
  credentials: true,
  exposedHeaders: ['X-RateLimit-Remaining'],
  maxAge: 86400, // 1 day
});

// All routes now support CORS
```

## Features

- **Automatic Preflight**: Handles `OPTIONS` requests transparently
- **Strict Validation**: Throws at startup if you misconfigure (e.g., `credentials: true` + `origin: '*'`)
- **Proper Cache Headers**: Emits `Vary: Origin`, `Access-Control-Max-Age` for optimal CDN behavior
- **Flexible Origins**: String, array, or function-based origin matching
- **Credential Support**: Safely enable cookies/auth headers when needed

## API Reference

### `useCors(app, options)`

Registers the CORS middleware on the app.

**Options:**

```typescript
interface CorsOptions {
  // Origin: string | string[] | ((origin: string) => boolean)
  // - '*' for any origin (cannot be combined with credentials: true)
  // - 'https://example.com' for a single origin
  // - ['https://a.com', 'https://b.com'] for a whitelist
  // - (origin) => origin.endsWith('.example.com') for dynamic matching
  origin?: string | string[] | ((origin: string) => boolean);
  
  // Whether to include the Access-Control-Allow-Credentials header
  credentials?: boolean; // default: false
  
  // Additional headers to expose to browsers
  exposedHeaders?: string[]; // default: []
  
  // How long the browser should cache preflight results (in seconds)
  maxAge?: number; // default: 86400 (1 day)
  
  // HTTP methods to allow
  methods?: string[]; // default: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
  
  // Headers the browser is allowed to send
  allowedHeaders?: string[]; // default: ['Content-Type', 'Authorization']
}
```

## Examples

### Allow All Origins (No Credentials)

```typescript
useCors(app, {
  origin: '*', // CORS on every domain
  // credentials must be false (the default)
});
```

### Allow Specific Origins with Credentials

```typescript
useCors(app, {
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true, // Allows cookies and auth headers
  exposedHeaders: ['X-Total-Count', 'X-Page-Number'],
});
```

### Dynamic Origin Matching

```typescript
useCors(app, {
  // Allow all subdomains of example.com
  origin: (origin) => {
    return origin?.endsWith('.example.com') || origin === 'https://example.com';
  },
  credentials: true,
});
```

### Restrict to GET/POST Only

```typescript
useCors(app, {
  origin: 'https://trusted.example.com',
  methods: ['GET', 'POST'],
  maxAge: 3600, // Cache for 1 hour
});
```

## Important: Dangerous Combinations

The plugin **throws at startup** if you misconfigure CORS in a way that violates the spec:

```typescript
// ❌ This throws immediately!
useCors(app, {
  origin: '*',
  credentials: true, // Illegal combination!
});

// ✅ Correct: choose one approach
useCors(app, {
  origin: '*', // Wildcard, no credentials
});
// or
useCors(app, {
  origin: 'https://trusted.example.com', // Specific origin, with credentials
  credentials: true,
});
```

This prevents subtle bugs where your browser rejects responses that technically comply with your backend's CORS configuration.

## How It Works

1. **Preflight Requests**: Browsers send an `OPTIONS` request before cross-origin requests to certain methods/headers. The plugin handles these automatically and returns `204 No Content`.

2. **Vary Header**: For non-wildcard origins, the plugin emits `Vary: Origin`. This tells CDNs and proxies to cache separately per origin, preventing one user from seeing another user's cached response.

3. **Credentials**: When `credentials: true`, the response includes `Access-Control-Allow-Credentials: true` and must specify an exact origin (never wildcard).

4. **Exposed Headers**: By default, browsers only see a few response headers (e.g., `Content-Type`). Use `exposedHeaders` to whitelist additional headers like pagination or rate-limit info.

## Testing

```typescript
import fetch from 'node-fetch';

it('allows requests from whitelisted origins', async () => {
  const res = await fetch('http://localhost:3000/api/users', {
    headers: { Origin: 'https://app.example.com' },
  });
  
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
});

it('sends Vary header for non-wildcard origins', async () => {
  const res = await fetch('http://localhost:3000/api/users', {
    headers: { Origin: 'https://app.example.com' },
  });
  
  expect(res.headers.get('Vary')).toContain('Origin');
});

it('handles preflight OPTIONS requests', async () => {
  const res = await fetch('http://localhost:3000/api/users', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'POST',
    },
  });
  
  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Max-Age')).toBeTruthy();
});
```

## Migration from v3.x

In v4.0.0, CORS is stricter and will throw at startup if you combine `credentials: true` with `origin: '*'`. Update your configuration:

```typescript
// ❌ Before (now throws)
useCors(app, { origin: '*', credentials: true });

// ✅ After (option 1: specific origins)
useCors(app, { origin: ['https://a.com', 'https://b.com'], credentials: true });

// ✅ After (option 2: wildcard, no credentials)
useCors(app, { origin: '*' });
```

## License

MIT