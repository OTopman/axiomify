# @axiomify/helmet

HTTP security headers middleware for Axiomify apps.

## Install

```bash
npm install @axiomify/helmet
```

## Usage

```ts
import { useHelmet } from '@axiomify/helmet';

useHelmet(app, {
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: "default-src 'self'",
  removeHeaders: ['X-Powered-By', 'Server'],
});
```

## Defaults include

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Embedder-Policy`
- `Cross-Origin-Resource-Policy`
- `Origin-Agent-Cluster`
- `X-Robots-Tag`

## Options

All options are configurable and can be disabled (`false`) where applicable:
- `hsts`
- `contentSecurityPolicy`
- `xContentTypeOptions`
- `xFrameOptions`
- `xXssProtection`
- `referrerPolicy`
- `permissionsPolicy`
- `xDownloadOptions`
- `xPermittedCrossDomainPolicies`
- `xDnsPrefetchControl`
- `crossOriginEmbedderPolicy`
- `crossOriginOpenerPolicy`
- `crossOriginResourcePolicy`
- `originAgentCluster`
- `xRobotsTag`
- `removeHeaders`
- `removePoweredBy`
