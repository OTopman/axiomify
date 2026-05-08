import { describe, it, expect } from 'vitest';
import { useFingerprint } from '../src';

describe('Fingerprint Package', () => {
  const setup = (options: any = {}) => {
    const app = {
      addHook: (name: string, hook: any) => ((app as any).hook = hook),
    } as any;
    useFingerprint(app, options);
    return (app as any).hook;
  };

  it('should generate a stable fingerprint for same request', async () => {
    const hook = setup();

    const req: any = {
      headers: {
        'user-agent': 'test-agent',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip',
      },
      ip: '127.0.0.1',
      path: '/',
      state: {},
    };

    await hook(req);
    const fp1 = req.state.fingerprint;
    expect(fp1).toBeDefined();
    expect(req.state.fingerprintConfidence).toBeGreaterThanOrEqual(32);

    req.state = {};
    await hook(req);
    const fp2 = req.state.fingerprint;
    expect(fp1).toBe(fp2);
  });

  it('should generate different fingerprints for different IPs', async () => {
    const hook = setup();

    const req1: any = {
      headers: { 'user-agent': 'test-agent' },
      ip: '1.1.1.1',
      path: '/',
      state: {},
    };
    const req2: any = {
      headers: { 'user-agent': 'test-agent' },
      ip: '2.2.2.2',
      path: '/',
      state: {},
    };

    await hook(req1);
    await hook(req2);

    expect(req1.state.fingerprint).not.toBe(req2.state.fingerprint);
  });

  it('should use x-forwarded-for when trustProxyHeaders is enabled', async () => {
    const hook = setup({ trustProxyHeaders: true });

    const req: any = {
      headers: {
        'user-agent': 'test-agent',
        'x-forwarded-for': '203.0.113.4, 10.0.0.1',
      },
      ip: '10.0.0.1',
      path: '/',
      state: {},
    };

    await hook(req);
    expect(req.state.fingerprintData.ip).toBe('203.0.113.4');
  });
});
