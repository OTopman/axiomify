import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

let uwsSupported = false;
try {
  require('uWebSockets.js');
  uwsSupported = true;
} catch {
  uwsSupported = false;
}

describe.skipIf(!uwsSupported)('NativeAdapter TLS/HTTPS', () => {
  let app: any;
  let adapter: any;
  const PORT = 3010;

  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const keyPath = path.resolve(fixturesDir, 'key.pem');
  const certPath = path.resolve(fixturesDir, 'cert.pem');

  beforeAll(async () => {
    // Dynamically generate self-signed cert and key
    fs.mkdirSync(fixturesDir, { recursive: true });
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
        `-sha256 -days 365 -nodes -subj "/CN=localhost"`,
      { stdio: 'ignore' }
    );

    // Disable TLS verification for self-signed cert in tests
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');

    app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/secure-ping',
      handler: async (_req: any, res: any) => {
        res.send({ secure: true });
      },
    });

    return new Promise<void>((resolve) => {
      adapter = new NativeAdapter(app, {
        port: PORT,
        tls: {
          keyFile: keyPath,
          certFile: certPath,
        },
      });
      adapter.listen(() => resolve());
    });
  });

  afterAll(() => {
    if (adapter) {
      adapter.close();
    }
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    // Clean up dynamically generated cert/key files
    try {
      fs.rmSync(fixturesDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it('serves secure requests over HTTPS using SSLApp', async () => {
    const res = await fetch(`https://localhost:${PORT}/secure-ping`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.secure).toBe(true);
  });
});
