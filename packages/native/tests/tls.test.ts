import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import https from 'https';

let uwsSupported = false;
try {
  require('uWebSockets.js');
  uwsSupported = true;
} catch {
  uwsSupported = false;
}

/**
 * Helper: HTTPS GET request trusting the custom CA
 */
function fetchHttps(url: string, ca: Buffer): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        ca,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            json: async () => JSON.parse(body),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
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

    // Clean up dynamically generated cert/key files
    try {
      fs.rmSync(fixturesDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it('serves secure requests over HTTPS using SSLApp', async () => {
    const ca = fs.readFileSync(certPath);
    const res = await fetchHttps(`https://localhost:${PORT}/secure-ping`, ca);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.secure).toBe(true);
  });
});
