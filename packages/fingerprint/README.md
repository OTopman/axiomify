# @axiomify/fingerprint

Client/request fingerprinting middleware for Axiomify.

## Install

```bash
npm install @axiomify/fingerprint
```

## Usage

```ts
import { useFingerprint } from '@axiomify/fingerprint';

useFingerprint(app, {
  includeIp: true,
  includePath: false,
  additionalHeaders: ['x-device-id'],
});
```

For each request, the plugin stores:

- `req.state.fingerprint`
- `req.state.fingerprintData`
- `req.state.fingerprintConfidence` (0-98)

## Options

- `algorithm?: string` (default: `sha256`)
- `salt?: string`
- `includeIp?: boolean`
- `includePath?: boolean`
- `additionalHeaders?: string[]`
