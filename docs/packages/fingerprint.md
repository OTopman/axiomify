# @axiomify/fingerprint

Client/request fingerprinting middleware.

This package fingerprints server-observable request signals. For advanced browser/device
intelligence and anti-fraud telemetry, pair this with a client SDK.

## Install

```bash
npm install @axiomify/fingerprint
```

## Export

- `useFingerprint(app, options?)`

## Options

- `algorithm`
- `salt`
- `includeIp`
- `includePath`
- `additionalHeaders`
- `trustProxyHeaders`

## Example

```ts
import { useFingerprint } from '@axiomify/fingerprint';

useFingerprint(app, {
  includeIp: true,
  includePath: false,
  additionalHeaders: ['x-device-id'],
});
```

## Request state fields

- `req.state.fingerprint`
- `req.state.fingerprintData`
- `req.state.fingerprintConfidence`
