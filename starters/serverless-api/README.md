# Axiomify serverless API starter

A small Fetch API application for Node-compatible serverless platforms. It
exports a standard `(Request) => Promise<Response>` handler and includes
bounded body reads, typed route contracts, and an inject-style contract test.

## Run and verify

```bash
npm install
npm test
npm run typecheck
```

Import `fetchHandler` in the platform's entrypoint and export it using that
platform's required shape. See [the adapter guide](../../docs/packages/serverless.md)
for Node compatibility requirements and platform-specific caveats.

The sample uses in-memory storage and is not durable across cold starts or
multiple instances. Replace it with a persistent database, add platform-native
secret management and rate limiting, and set an explicit request body limit
for your workload before production use.
