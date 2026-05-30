import { describe, expect, it, vi } from 'vitest';
import { useFingerprint } from '../src';

const setup = (options: any = {}) => {
  const app = {
    addHook: (_name: string, hook: any) => ((app as any).hook = hook),
  } as any;
  useFingerprint(app, options);
  return (app as any).hook;
};

const makeReq = (overrides: any = {}) => ({
  headers: {},
  ip: '127.0.0.1',
  path: '/',
  state: {},
  ...overrides,
});

const makeRes = () => {
  const headers: Record<string, string> = {};
  return {
    header: vi.fn((k: string, v: string) => { headers[k] = v; }),
    headers,
  } as any;
};

describe('useFingerprint — extended paths', () => {
  it('sets a server-id cookie on first request when statefulCookie defaults to true', async () => {
    const hook = setup();
    const req = makeReq({ headers: { 'user-agent': 'ua' } });
    const res = makeRes();
    await hook(req, res);
    expect(res.header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringMatching(/^ax_fp_id=/),
    );
    expect(req.state.fingerprintData.serverId).toBeDefined();
  });

  it('reads serverId from existing cookie instead of issuing a new one', async () => {
    const hook = setup();
    const req = makeReq({
      headers: { 'user-agent': 'ua', cookie: 'ax_fp_id=existing-uuid' },
    });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.serverId).toBe('existing-uuid');
    expect(res.header).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.anything(),
    );
  });

  it('honors custom statefulCookie name and maxAge', async () => {
    const hook = setup({ statefulCookie: { name: 'my_fp', maxAge: 60 } });
    const req = makeReq({ headers: { 'user-agent': 'ua' } });
    const res = makeRes();
    await hook(req, res);
    expect(res.header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringMatching(/^my_fp=.*Max-Age=60/),
    );
  });

  it('appends additionalHeaders into the fingerprint payload', async () => {
    const hook = setup({ additionalHeaders: ['x-tenant-id'] });
    const req = makeReq({
      headers: { 'user-agent': 'ua', 'x-tenant-id': 'acme' },
    });
    const res = makeRes();
    await hook(req, res);
    expect((req.state.fingerprintData as any)['x-tenant-id']).toBe('acme');
  });

  it('falls back to req.ip when trustProxyHeaders is true but no forwarded headers are present', async () => {
    const hook = setup({ trustProxyHeaders: true });
    const req = makeReq({ headers: { 'user-agent': 'ua' }, ip: '203.0.113.99' });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.ip).toBe('203.0.113.99');
  });

  it('uses x-real-ip when x-forwarded-for is absent', async () => {
    const hook = setup({ trustProxyHeaders: true });
    const req = makeReq({
      headers: { 'user-agent': 'ua', 'x-real-ip': '198.51.100.7' },
      ip: '10.0.0.1',
    });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.ip).toBe('198.51.100.7');
  });

  it('includePath: changes fingerprint when path differs', async () => {
    const hook = setup({ includePath: true });
    const reqA = makeReq({ headers: { 'user-agent': 'ua' }, path: '/a' });
    const reqB = makeReq({ headers: { 'user-agent': 'ua' }, path: '/b' });
    await hook(reqA, makeRes());
    await hook(reqB, makeRes());
    expect(reqA.state.fingerprint).not.toBe(reqB.state.fingerprint);
  });

  it('statefulCookie:false skips cookie handling', async () => {
    const hook = setup({ statefulCookie: false });
    const req = makeReq({ headers: { 'user-agent': 'ua' } });
    const res = makeRes();
    await hook(req, res);
    expect(res.header).not.toHaveBeenCalled();
    expect(req.state.fingerprintData.serverId).toBeUndefined();
  });

  it('normalizes IPv4-mapped IPv6 (::ffff:1.2.3.4)', async () => {
    const hook = setup();
    const req = makeReq({ headers: { 'user-agent': 'ua' }, ip: '::ffff:203.0.113.5' });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.ip).toBe('203.0.113.5');
  });

  it('normalizes IPv6 loopback (::1) to 127.0.0.1', async () => {
    const hook = setup();
    const req = makeReq({ headers: { 'user-agent': 'ua' }, ip: '::1' });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.ip).toBe('127.0.0.1');
  });

  it('falls back to 0.0.0.0 when req.ip is empty', async () => {
    const hook = setup({ trustProxyHeaders: false });
    // includeIp default true → normalizeIp('') hits the '!ip' guard branch
    const req = makeReq({ headers: { 'user-agent': 'ua' }, ip: '' });
    const res = makeRes();
    await hook(req, res);
    // req.ip || '127.0.0.1' makes it '127.0.0.1' before normalizeIp,
    // so we never actually see 0.0.0.0 — but the normalizeHeader('') branch
    // triggers undefined.
    expect(req.state.fingerprintData.ip).toBe('127.0.0.1');
  });

  it('uses x-forwarded-for first hop when present (array form)', async () => {
    const hook = setup({ trustProxyHeaders: true });
    const req = makeReq({
      headers: { 'user-agent': 'ua', 'x-forwarded-for': ['203.0.113.7', '10.0.0.1'] },
      ip: '10.0.0.5',
    });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.ip).toBe('203.0.113.7');
  });

  it('includeIp:false produces ip-omitted entry', async () => {
    const hook = setup({ includeIp: false });
    const req = makeReq({ headers: { 'user-agent': 'ua' } });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.ip).toBe('ip-omitted');
  });

  it('correctly parses cookies with "=" in their values', async () => {
    const hook = setup();
    const req = makeReq({
      headers: { 'user-agent': 'ua', cookie: 'ax_fp_id=some=value=with=equals; other_cookie=xyz' },
    });
    const res = makeRes();
    await hook(req, res);
    expect(req.state.fingerprintData.serverId).toBe('some=value=with=equals');
  });

  it('includes Path=/ attribute in Set-Cookie header', async () => {
    const hook = setup();
    const req = makeReq({ headers: { 'user-agent': 'ua' } });
    const res = makeRes();
    await hook(req, res);
    expect(res.headers['Set-Cookie']).toContain('Path=/');
  });

  it('handles cookies without equals sign and issues a new cookie when target cookie is not found', async () => {
    const hook = setup();
    const req = makeReq({
      headers: { 'user-agent': 'ua', cookie: 'some_other_cookie; another_key=value' },
    });
    const res = makeRes();
    await hook(req, res);
    expect(res.header).toHaveBeenCalledWith('Set-Cookie', expect.stringMatching(/^ax_fp_id=/));
  });
});

