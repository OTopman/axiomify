import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useFingerprint } from '../src';

describe('Fingerprint Package', () => {
  it('should generate a stable fingerprint for same request', async () => {
    const app = new Axiomify();
    useFingerprint(app);

    const req: any = {
      headers: { 'user-agent': 'test-agent', 'accept-language': 'en-US' },
      ip: '127.0.0.1',
      method: 'GET',
      path: '/',
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await (app as any).handle(req, res);
    const fp1 = req.state.fingerprint;
    expect(fp1).toBeDefined();
    expect(req.state.fingerprintConfidence).toBeGreaterThanOrEqual(50);

    req.state = {};
    await (app as any).handle(req, res);
    const fp2 = req.state.fingerprint;
    expect(fp1).toBe(fp2);
  });

  it('should generate different fingerprints for different IPs', async () => {
    const app = new Axiomify();
    useFingerprint(app);

    const req1: any = {
      headers: { 'user-agent': 'test-agent' },
      ip: '1.1.1.1',
      method: 'GET',
      path: '/',
      state: {},
    };
    const req2: any = {
      headers: { 'user-agent': 'test-agent' },
      ip: '2.2.2.2',
      method: 'GET',
      path: '/',
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await (app as any).handle(req1, res);
    await (app as any).handle(req2, res);

    expect(req1.state.fingerprint).not.toBe(req2.state.fingerprint);
  });
});
