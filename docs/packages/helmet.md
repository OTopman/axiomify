# @axiomify/helmet

Security headers for Axiomify apps.

## Install

```bash
npm install @axiomify/helmet
```

## Export

- `useHelmet(app, options?)`

## Common options

- `hsts`
- `contentSecurityPolicy`
- `xContentTypeOptions`
- `xFrameOptions`
- `xXssProtection`
- `referrerPolicy`
- `permissionsPolicy`
- `crossOriginOpenerPolicy`
- `crossOriginEmbedderPolicy`
- `crossOriginResourcePolicy`
- `originAgentCluster`
- `xRobotsTag`
- `removeHeaders`
- `removePoweredBy`

## Example

```ts
useHelmet(app, {
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
  removeHeaders: ['X-Powered-By', 'Server'],
});
```

## Default behavior

By default, the plugin applies strict modern headers including HSTS, CSP,
COOP/COEP/CORP, referrer policy, permissions policy, and strips sensitive
response headers.
