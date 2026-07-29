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
function fetchHttps(
  url: string,
  ca: Buffer,
): Promise<{ status: number; json: () => Promise<any> }> {
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
      },
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
    fs.mkdirSync(fixturesDir, { recursive: true });
    if (!fs.existsSync(keyPath)) {
      fs.writeFileSync(
        keyPath,
        `-----BEGIN PRIVATE KEY-----\n` +
          `MIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQDMotiPF10ZjYEO\n` +
          `amSfB6L44SBhty8bRHbybtVDSQBVbXleeTJC8aqsr0SCP/ofNGjLmaUeszMpPm7q\n` +
          `3uV8EKlgfArPD5GGCGbvMg9xA2c/Ur529pa0D387v6e6lHMrvn48Vij/xI72ivNo\n` +
          `+HAA5gg3TLd3O+2EmP6B43fZFa6IMM9jrkSouvPV/pGQxEvUWZbt8+11pbXIwHx0\n` +
          `RxxH1y3VRUgBV2FVKTz+4qXmLb7JYshx/k5kdH4b9isbbCMrO4ExnekaM90JFWeM\n` +
          `jLCe4gkIpRL7lVoOZiENjffpk3ecRe026CtuCUk6/no21ywLqNyi7WzUlQ4lAgjB\n` +
          `148iB0djAgMBAAECgf8VA3Zj6yTTaaM4ac2c1Yu5LU8Jrr+jrV9u2Pd7TG0DBX/5\n` +
          `uqRMGP9sLtIiaDoLYe63V9QMaP3LYo+/T8q+n3tPXWc3rPOnkQYxov1cKuwGDZJH\n` +
          `UdQefWYN3AzOV8BBykSI7Ar7Ok0Y3mkrbgkNo8VZ6GK5Ofn0lBx6DIgwzAecM0FS\n` +
          `iRyrOUdAr4VvcyT6JnOo7R2Gm4u0kyVsrVPWHvUYL+YuTN4frSLMoKMMxMMj5/BP\n` +
          `LMvmuiUJiM1eNvPG/ffTH4Ewqa1FEf0mWO18U2HscGbtR9LP7q9wwRri4D2R2gud\n` +
          `QGXvJFtF2xQH8S8ngzBE97mXYOd9u81jrUIn09ECgYEA7UjwNPv/uckPhYKfHP3M\n` +
          `cRpmJd01ACGANnFofoys9mGkUn4zc3YvIxhXikU1wm8zT1wC02xLm+OCOzCp92BG\n` +
          `pLO1iYT8HseKpqAhR/4GY/7trxy4Ur1HR0hD3aa9kJ4rJpIgGM4S1BhG0FvLreAC\n` +
          `o8m4V3+vQrH6H+nGD3Hn9fkCgYEA3MawoW3WkODGpt3qfBxUdM3181i0LhhOgQtX\n` +
          `gIjqU+IAT8khIGg6IGGHVnOO0JyQgPdr9m7ZRruq+IO3WGE3JYzK4QtAvvjZAe6U\n` +
          `89fdDEvMHcC8oRat7gmYq5eOxLie+OPoCKGxMTrRR4uRMYlLLgIp2L619BbZQpNq\n` +
          `9YVoDzsCgYAwWnuwoGWlS2ahU1PvSXze031bW++P/kOtVIDxwOMCNjWRJeyAK+ZB\n` +
          `JZW5NI9W9ugi1OIyiVADDWKdgzYvlevvZjupMXNbJliHyfveOtK8j9eJprWdDrs2\n` +
          `uHAz++WHUeQDMSXfSCcoF2Ze0UX5Qbvn+pRZKEjjs3cAB9h3j0OwqQKBgGLaE/wz\n` +
          `0f7MpiXQ90za4nXqQlXTQdnhyES/b059/23Po5QV2l9IS75z7MUouKlvcMROBGky\n` +
          `+NZS8RqU32MTJD4L7EsXXsYjZgcXbFpCLRd0WNB5m/wEy5vpcBJkqegrQgLvCNXU\n` +
          `kCIa09nVBA3KC39uOI5z1cSU9nJ4z0tfkFhBAoGAISxLsa67LMTgDe/R8EhvuL5g\n` +
          `t+Mxu+ExDKp4g7GCvcFO1cTuUzLf/7IPbgt7104KU/dy8tn2QI7Jtu5bAjk6D+we\n` +
          `YyrdB9AbgmiIY1ZU/XHtY8sJruVw5drluKN4HcFDIKHoXWeesV3qGrzhFyurh2VM\n` +
          `qhPPFUBBlWQayk11NhU=\n` +
          `-----END PRIVATE KEY-----\n`,
      );
    }
    if (!fs.existsSync(certPath)) {
      fs.writeFileSync(
        certPath,
        `-----BEGIN CERTIFICATE-----\n` +
          `MIIDCTCCAfGgAwIBAgIUFOcxtv2mn5QsOjIbVowh/DBRhSgwDQYJKoZIhvcNAQEL\n` +
          `BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDcyOTIyNDY1OVoXDTM2MDcy\n` +
          `NjIyNDY1OVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF\n` +
          `AAOCAQ8AMIIBCgKCAQEAzKLYjxddGY2BDmpknwei+OEgYbcvG0R28m7VQ0kAVW15\n` +
          `XnkyQvGqrK9Egj/6HzRoy5mlHrMzKT5u6t7lfBCpYHwKzw+Rhghm7zIPcQNnP1K+\n` +
          `dvaWtA9/O7+nupRzK75+PFYo/8SO9orzaPhwAOYIN0y3dzvthJj+geN32RWuiDDP\n` +
          `Y65EqLrz1f6RkMRL1FmW7fPtdaW1yMB8dEccR9ct1UVIAVdhVSk8/uKl5i2+yWLI\n` +
          `cf5OZHR+G/YrG2wjKzuBMZ3pGjPdCRVnjIywnuIJCKUS+5VaDmYhDY336ZN3nEXt\n` +
          `NugrbglJOv56NtcsC6jcou1s1JUOJQIIwdePIgdHYwIDAQABo1MwUTAdBgNVHQ4E\n` +
          `FgQUIQ3ibW7Z/BtF1KEM3oh916m4FmkwHwYDVR0jBBgwFoAUIQ3ibW7Z/BtF1KEM\n` +
          `3oh916m4FmkwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAH2ZG\n` +
          `V7Nd18EFWKedj1HMN+ddZe4EtuhQOk0i2eQkHTBoPWQ0Bssn4SBsg3N8fwDZngpi\n` +
          `B/yt2Q87ypJ6ThIST+riCmD8iUTw1Wvh6P5yzqs0sDXcPtFDYrAPXp6dRw02Ekkq\n` +
          `BmVpuTSndCp1e5Qoj4/oAFi2+TFiv3nfZYzQFEYbvVuBhohj9xeUxfn7nxOmHjep\n` +
          `Ldh38j2nkTLg8Lr+n58dT9u1baSL6qc1MkJ1pfqXBDLpofTjhKPIMUmsZUjBDP3e\n` +
          `JwtSUuzijPgLhyDBMK09oc9Zf+8Ml5fFBZ4GufaJREgDDYbMPzCtQXDyGJD6koYj\n` +
          `btiFYgFHfRu5nnb42Q==\n` +
          `-----END CERTIFICATE-----\n`,
      );
    }

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
