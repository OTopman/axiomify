# @axiomify/fingerprint

Client/request fingerprinting middleware.

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
