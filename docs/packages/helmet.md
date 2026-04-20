# @axiomify/helmet

Security headers for Axiomify apps.

## Install

```bash
npm install @axiomify/helmet
```

## Export

- `useHelmet(app, options?)`

## Main Options

- `hsts`
- `hstsMaxAge`
- `hstsIncludeSubDomains`
- `contentSecurityPolicy`
- `xContentTypeOptions`
- `xFrameOptions`
- `xXssProtection`
- `referrerPolicy`
- `permissionsPolicy`

## Example

```ts
useHelmet(app, {
  hsts: true,
  contentSecurityPolicy: "default-src 'self'",
});
```
