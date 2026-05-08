import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRefreshHandler, MemoryTokenStore } from '../src/index';

describe('refresh token rotation integration', () => {
  const secret = 'access-secret-that-is-at-least-32-characters-abc';
  const refreshSecret = 'refresh-secret-that-is-at-least-32-chars-xyz';

  it('issues new refresh token with new jti after successful rotation', async () => {
    const store = new MemoryTokenStore();
    const handler = createRefreshHandler({ secret, refreshSecret, store, refreshTokenTtl: 300 });

    const initialJti = 'first-jti';
    await store.save(initialJti, 300);
    const token = jwt.sign({ id: 'user-1', jti: initialJti }, refreshSecret);

    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const res = { status: (code: number) => ({ send: (payload: any) => ({ code, payload }) }) } as any;

    const out: any = {};
    const res2 = {
      status: (code: number) => {
        out.code = code;
        return { send: (payload: any) => (out.payload = payload) };
      },
    } as any;

    await handler(req, res2);
    expect(out.code).toBe(200);

    const decoded = jwt.decode(out.payload.refreshToken) as jwt.JwtPayload;
    expect(typeof decoded.jti).toBe('string');
    expect(decoded.jti).not.toBe(initialJti);
    expect(await store.exists(decoded.jti!)).toBe(true);
  });
});
