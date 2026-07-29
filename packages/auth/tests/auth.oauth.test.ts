import { createHash, generateKeyPairSync } from 'node:crypto';
import { signCookieValue, unsignCookieValue } from '@axiomify/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOAuthPlugin,
  OAuthError,
  signJwt,
  type OAuthResult,
} from '../src/index';

const COOKIE_SECRET = 'oauth-cookie-secret-at-least-32-bytes-long!!';
const ISSUER = 'https://id.example.com';
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/jwks`,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    headersSent: false,
    _headers: headers,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    header: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
      return res;
    }),
    getHeader: (k: string) => headers[k.toLowerCase()],
    send: vi.fn(),
  };
  return res;
}

/** Extract and decode the signed state cookie set by authorizeHandler. */
function readStateCookie(res: any) {
  const setCookie: string = res._headers['set-cookie'];
  expect(setCookie).toBeTruthy();
  const [pair] = setCookie.split(';');
  const eq = pair.indexOf('=');
  const name = pair.slice(0, eq);
  const raw = decodeURIComponent(pair.slice(eq + 1));
  const unsigned = unsignCookieValue(raw, COOKIE_SECRET);
  expect(unsigned.valid).toBe(true);
  const payload = JSON.parse(
    Buffer.from(unsigned.value!, 'base64url').toString('utf8'),
  );
  return { name, raw, payload, setCookie };
}

function oidcPlugin(extra: Record<string, unknown> = {}) {
  return createOAuthPlugin({
    provider: 'oidc',
    issuer: ISSUER,
    clientId: 'client-1',
    clientSecret: 'client-secret',
    redirectUri: 'https://app.example.com/auth/callback',
    cookieSecret: COOKIE_SECRET,
    ...extra,
  } as any);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createOAuthPlugin — configuration', () => {
  it('validates provider, clientId, redirectUri, cookieSecret and issuer', () => {
    const base = {
      provider: 'oidc' as const,
      issuer: ISSUER,
      clientId: 'c',
      redirectUri: 'https://app.example.com/cb',
      cookieSecret: COOKIE_SECRET,
    };
    expect(() => createOAuthPlugin({ ...base, provider: undefined as any })).toThrow(/provider/);
    expect(() => createOAuthPlugin({ ...base, clientId: '' })).toThrow(/clientId/);
    expect(() => createOAuthPlugin({ ...base, redirectUri: '/relative' })).toThrow(/absolute `redirectUri`/);
    expect(() => createOAuthPlugin({ ...base, cookieSecret: 'short' })).toThrow(/at least 32 bytes/);
    expect(() =>
      createOAuthPlugin({ ...base, issuer: undefined }),
    ).toThrow(/requires `issuer`.*or explicit `endpoints`/);
    expect(() =>
      createOAuthPlugin({
        ...base,
        provider: 'github',
        issuer: undefined,
      }),
    ).not.toThrow();
    expect(() =>
      createOAuthPlugin({ ...base, callbackHandler: undefined } as any).callbackHandler(
        undefined as any,
      ),
    ).toThrow(/onSuccess/);
  });
});

describe('authorizeHandler', () => {
  it('302-redirects with state, S256 PKCE challenge and a signed HttpOnly Lax cookie', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      if (String(url) === `${ISSUER}/.well-known/openid-configuration`) {
        return jsonResponse(DISCOVERY);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const plugin = oidcPlugin();
    const res = mockRes();
    await plugin.authorizeHandler({ headers: {}, state: {} } as any, res);

    expect(res.status).toHaveBeenCalledWith(302);
    expect(res.send).toHaveBeenCalledWith(null);
    const location = new URL(res._headers['location']);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/authorize`);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe('client-1');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/auth/callback',
    );
    expect(location.searchParams.get('scope')).toBe('openid profile email');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');

    const { name, payload, setCookie } = readStateCookie(res);
    expect(name).toBe('axiomify_oauth');
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=600/);
    expect(setCookie).toMatch(/Secure/); // https redirectUri

    // state round-trips through the cookie
    expect(payload.state).toBe(location.searchParams.get('state'));
    // challenge is the S256 hash of the verifier in the cookie
    const expectedChallenge = createHash('sha256')
      .update(payload.verifier)
      .digest('base64url');
    expect(location.searchParams.get('code_challenge')).toBe(expectedChallenge);
    // OIDC → nonce present in both cookie and URL
    expect(payload.nonce).toBe(location.searchParams.get('nonce'));
  });

  it('caches the discovery document across calls', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(DISCOVERY));
    vi.stubGlobal('fetch', fetchMock);
    const plugin = oidcPlugin();
    await plugin.authorizeHandler({ headers: {}, state: {} } as any, mockRes());
    await plugin.authorizeHandler({ headers: {}, state: {} } as any, mockRes());
    expect(
      fetchMock.mock.calls.filter(([u]) => String(u).includes('well-known')),
    ).toHaveLength(1);
  });

  it('github preset: no discovery, no nonce, github endpoints and scopes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const plugin = createOAuthPlugin({
      provider: 'github',
      clientId: 'gh-client',
      clientSecret: 'gh-secret',
      redirectUri: 'https://app.example.com/auth/github/callback',
      cookieSecret: COOKIE_SECRET,
    });
    const res = mockRes();
    await plugin.authorizeHandler({ headers: {}, state: {} } as any, res);

    expect(fetchMock).not.toHaveBeenCalled();
    const location = new URL(res._headers['location']);
    expect(location.origin + location.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('nonce')).toBeNull();
    expect(readStateCookie(res).payload.nonce).toBeUndefined();
  });

  it('surfaces discovery failures as OAuthError 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
    const plugin = oidcPlugin();
    await expect(
      plugin.authorizeHandler({ headers: {}, state: {} } as any, mockRes()),
    ).rejects.toMatchObject({ statusCode: 503, code: 'discovery_failed' });
  });
});

describe('callbackHandler — full mocked code flow', () => {
  async function runAuthorize(plugin: ReturnType<typeof oidcPlugin>) {
    const res = mockRes();
    await plugin.authorizeHandler({ headers: {}, state: {} } as any, res);
    const { raw, payload } = readStateCookie(res);
    return { cookieHeader: `axiomify_oauth=${raw}`, payload };
  }

  function oidcFetchMock(overrides: {
    idToken?: (nonce: string) => string;
    tokenStatus?: number;
    tokenBody?: Record<string, unknown>;
    userinfoStatus?: number;
  } = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    let latestNonce = '';
    const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return jsonResponse(DISCOVERY);
      }
      if (url === `${ISSUER}/oauth/token`) {
        if (overrides.tokenStatus) {
          return jsonResponse(
            { error: 'invalid_grant' },
            overrides.tokenStatus,
          );
        }
        return jsonResponse(
          overrides.tokenBody ?? {
            access_token: 'at-123',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'rt-456',
            scope: 'openid profile email',
            id_token: overrides.idToken?.(latestNonce),
          },
        );
      }
      if (url === `${ISSUER}/jwks`) {
        return jsonResponse({
          keys: [{ ...(rsa.publicKey.export({ format: 'jwk' }) as object), kid: 'op-key' }],
        });
      }
      if (url === `${ISSUER}/userinfo`) {
        if (overrides.userinfoStatus) return jsonResponse({}, overrides.userinfoStatus);
        return jsonResponse({ sub: 'user-1', email: 'jane@example.com' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    return {
      fetchMock,
      calls,
      setNonce: (n: string) => {
        latestNonce = n;
      },
    };
  }

  const makeIdToken = (nonce: string, extra: Record<string, unknown> = {}) =>
    signJwt(
      { sub: 'user-1', nonce, ...extra },
      {
        algorithm: 'RS256',
        privateKey: rsa.privateKey,
        keyid: 'op-key',
        issuer: ISSUER,
        audience: 'client-1',
        expiresIn: 300,
      },
    );

  it('exchanges the code (PKCE + client_secret), verifies the ID token and fetches userinfo', async () => {
    const mock = oidcFetchMock({ idToken: (nonce) => makeIdToken(nonce) });
    vi.stubGlobal('fetch', mock.fetchMock);

    const plugin = oidcPlugin();
    const { cookieHeader, payload } = await runAuthorize(plugin);
    mock.setNonce(payload.nonce);

    const onSuccess = vi.fn(async (_req, res, _result: OAuthResult) => {
      res.status(200).send({ ok: true });
    });
    const req: any = {
      url: '/auth/callback?code=auth-code-1&state=' + encodeURIComponent(payload.state),
      query: { code: 'auth-code-1', state: payload.state },
      headers: { cookie: cookieHeader },
      state: {},
    };
    const res = mockRes();
    await plugin.callbackHandler(onSuccess)(req, res);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    const result: OAuthResult = onSuccess.mock.calls[0][2];
    expect(result.tokens).toMatchObject({
      accessToken: 'at-123',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshToken: 'rt-456',
    });
    expect(result.tokens.idTokenClaims).toMatchObject({
      sub: 'user-1',
      iss: ISSUER,
      aud: 'client-1',
    });
    expect(result.profile).toEqual({ sub: 'user-1', email: 'jane@example.com' });

    // Token-exchange request body carries the PKCE verifier and credentials.
    const tokenCall = mock.calls.find((c) => c.url === `${ISSUER}/oauth/token`)!;
    expect(tokenCall.init?.method).toBe('POST');
    expect(tokenCall.init?.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    });
    const body = new URLSearchParams(String(tokenCall.init?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-1');
    expect(body.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('code_verifier')).toBe(payload.verifier);

    // Userinfo request is authenticated with the access token.
    const userinfoCall = mock.calls.find((c) => c.url === `${ISSUER}/userinfo`)!;
    expect((userinfoCall.init?.headers as any).authorization).toBe('Bearer at-123');

    // The one-shot state cookie is expired on the response.
    expect(res._headers['set-cookie']).toMatch(/axiomify_oauth=;/);
    expect(res._headers['set-cookie']).toMatch(/Max-Age=0/);
  });

  it('rejects a state mismatch with 400 and never contacts the token endpoint', async () => {
    const mock = oidcFetchMock();
    vi.stubGlobal('fetch', mock.fetchMock);
    const plugin = oidcPlugin();
    const { cookieHeader } = await runAuthorize(plugin);

    const onSuccess = vi.fn();
    const res = mockRes();
    await plugin.callbackHandler(onSuccess)(
      {
        query: { code: 'c', state: 'attacker-forged-state' },
        headers: { cookie: cookieHeader },
        state: {},
      } as any,
      res,
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(null, expect.stringContaining('state mismatch'));
    expect(mock.calls.some((c) => c.url === `${ISSUER}/oauth/token`)).toBe(false);
  });

  it('rejects a tampered state cookie with 400', async () => {
    const mock = oidcFetchMock();
    vi.stubGlobal('fetch', mock.fetchMock);
    const plugin = oidcPlugin();
    const { cookieHeader, payload } = await runAuthorize(plugin);

    // Flip the final MAC character.
    const tampered =
      cookieHeader.slice(0, -1) + (cookieHeader.endsWith('A') ? 'B' : 'A');
    const res = mockRes();
    await plugin.callbackHandler(vi.fn())(
      {
        query: { code: 'c', state: payload.state },
        headers: { cookie: tampered },
        state: {},
      } as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      null,
      expect.stringContaining('signature is invalid'),
    );
  });

  it('rejects a missing state cookie, missing params and provider errors with 400', async () => {
    vi.stubGlobal('fetch', oidcFetchMock().fetchMock);
    const plugin = oidcPlugin();
    const handler = plugin.callbackHandler(vi.fn());

    const noCookie = mockRes();
    await handler({ query: { code: 'c', state: 's' }, headers: {}, state: {} } as any, noCookie);
    expect(noCookie.status).toHaveBeenCalledWith(400);

    const noParams = mockRes();
    await handler({ query: {}, headers: {}, state: {} } as any, noParams);
    expect(noParams.status).toHaveBeenCalledWith(400);

    const denied = mockRes();
    await handler(
      {
        query: { error: 'access_denied', error_description: 'User denied' },
        headers: {},
        state: {},
      } as any,
      denied,
    );
    expect(denied.status).toHaveBeenCalledWith(400);
    expect(denied.send).toHaveBeenCalledWith(
      null,
      expect.stringContaining('access_denied'),
    );
  });

  it('rejects an expired login attempt (old iat in the cookie)', async () => {
    vi.stubGlobal('fetch', oidcFetchMock().fetchMock);
    const plugin = oidcPlugin();
    const stale = {
      state: 's1',
      verifier: 'v1',
      iat: Math.floor(Date.now() / 1000) - 700, // > 600s TTL
    };
    const raw = signCookieValue(
      Buffer.from(JSON.stringify(stale)).toString('base64url'),
      COOKIE_SECRET,
    );
    const res = mockRes();
    await plugin.callbackHandler(vi.fn())(
      {
        query: { code: 'c', state: 's1' },
        headers: { cookie: `axiomify_oauth=${raw}` },
        state: {},
      } as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(null, expect.stringContaining('expired'));
  });

  it('maps a 400 from the token endpoint to OAuthError token_exchange_failed (502) via onError', async () => {
    const mock = oidcFetchMock({ tokenStatus: 400 });
    vi.stubGlobal('fetch', mock.fetchMock);
    const plugin = oidcPlugin();
    const { cookieHeader, payload } = await runAuthorize(plugin);

    const onError = vi.fn();
    const onSuccess = vi.fn();
    await plugin.callbackHandler(onSuccess, onError)(
      {
        query: { code: 'bad-code', state: payload.state },
        headers: { cookie: cookieHeader },
        state: {},
      } as any,
      mockRes(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const err: OAuthError = onError.mock.calls[0][2];
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe('token_exchange_failed');
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('invalid_grant');
  });

  it('rejects an ID token whose nonce does not match this login attempt', async () => {
    const mock = oidcFetchMock({
      idToken: () => makeIdToken('nonce-from-someone-else'),
    });
    vi.stubGlobal('fetch', mock.fetchMock);
    const plugin = oidcPlugin();
    const { cookieHeader, payload } = await runAuthorize(plugin);

    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      {
        query: { code: 'c', state: payload.state },
        headers: { cookie: cookieHeader },
        state: {},
      } as any,
      mockRes(),
    );
    expect(onError.mock.calls[0][2]).toMatchObject({
      code: 'nonce_mismatch',
      statusCode: 401,
    });
  });

  it('rejects an ID token signed for another audience or issuer', async () => {
    const mock = oidcFetchMock();
    vi.stubGlobal('fetch', mock.fetchMock);
    const plugin = oidcPlugin();
    const { cookieHeader, payload } = await runAuthorize(plugin);
    mock.setNonce(payload.nonce);

    const forged = signJwt(
      { sub: 'user-1', nonce: payload.nonce },
      {
        algorithm: 'RS256',
        privateKey: rsa.privateKey,
        keyid: 'op-key',
        issuer: ISSUER,
        audience: 'some-other-client',
        expiresIn: 300,
      },
    );
    vi.stubGlobal(
      'fetch',
      oidcFetchMock({ idToken: () => forged }).fetchMock,
    );

    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      {
        query: { code: 'c', state: payload.state },
        headers: { cookie: cookieHeader },
        state: {},
      } as any,
      mockRes(),
    );
    expect(onError.mock.calls[0][2]).toMatchObject({
      code: 'invalid_id_token',
      statusCode: 401,
    });
  });

  it('maps userinfo failures to 502', async () => {
    const mock = oidcFetchMock({
      idToken: (nonce) => makeIdToken(nonce),
      userinfoStatus: 500,
    });
    vi.stubGlobal('fetch', mock.fetchMock);
    const plugin = oidcPlugin();
    const { cookieHeader, payload } = await runAuthorize(plugin);
    mock.setNonce(payload.nonce);

    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      {
        query: { code: 'c', state: payload.state },
        headers: { cookie: cookieHeader },
        state: {},
      } as any,
      mockRes(),
    );
    expect(onError.mock.calls[0][2]).toMatchObject({
      code: 'userinfo_failed',
      statusCode: 502,
    });
  });

  it('completes the GitHub (non-OIDC) flow via api.github.com/user', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === 'https://github.com/login/oauth/access_token') {
          return jsonResponse({ access_token: 'gh-at', token_type: 'bearer', scope: 'read:user' });
        }
        if (url === 'https://api.github.com/user') {
          return jsonResponse({ id: 99, login: 'octocat' });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const plugin = createOAuthPlugin({
      provider: 'github',
      clientId: 'gh-client',
      clientSecret: 'gh-secret',
      redirectUri: 'https://app.example.com/auth/github/callback',
      cookieSecret: COOKIE_SECRET,
    });

    const authRes = mockRes();
    await plugin.authorizeHandler({ headers: {}, state: {} } as any, authRes);
    const { raw, payload } = readStateCookie(authRes);

    const onSuccess = vi.fn();
    await plugin.callbackHandler(onSuccess)(
      {
        query: { code: 'gh-code', state: payload.state },
        headers: { cookie: `axiomify_oauth=${raw}` },
        state: {},
      } as any,
      mockRes(),
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const result: OAuthResult = onSuccess.mock.calls[0][2];
    expect(result.tokens.accessToken).toBe('gh-at');
    expect(result.tokens.idToken).toBeUndefined();
    expect(result.profile).toEqual({ id: 99, login: 'octocat' });

    const userCall = calls.find((c) => c.url === 'https://api.github.com/user')!;
    expect((userCall.init?.headers as any)['user-agent']).toBe('axiomify-auth');
  });

  it('parses callback params from req.url when the adapter does not populate query', async () => {
    const mock = oidcFetchMock({ idToken: (n) => makeIdToken(n) });
    vi.stubGlobal('fetch', mock.fetchMock);
    const plugin = oidcPlugin();
    const { cookieHeader, payload } = await runAuthorize(plugin);
    mock.setNonce(payload.nonce);

    const onSuccess = vi.fn();
    await plugin.callbackHandler(onSuccess)(
      {
        url: `/cb?code=c1&state=${encodeURIComponent(payload.state)}`,
        headers: { cookie: cookieHeader },
        state: {},
      } as any,
      mockRes(),
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when an ID token arrives but no JWKS URI is known', async () => {
    const plugin = createOAuthPlugin({
      provider: 'oidc',
      endpoints: {
        authorizationEndpoint: `${ISSUER}/authorize`,
        tokenEndpoint: `${ISSUER}/oauth/token`,
      },
      clientId: 'client-1',
      redirectUri: 'https://app.example.com/cb',
      cookieSecret: COOKIE_SECRET,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        if (String(input) === `${ISSUER}/oauth/token`) {
          return jsonResponse({ access_token: 'at', id_token: 'x.y.z' });
        }
        throw new Error(`unexpected fetch ${input}`);
      }),
    );

    const authRes = mockRes();
    await plugin.authorizeHandler({ headers: {}, state: {} } as any, authRes);
    const { raw, payload } = readStateCookie(authRes);

    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      {
        query: { code: 'c', state: payload.state },
        headers: { cookie: `axiomify_oauth=${raw}` },
        state: {},
      } as any,
      mockRes(),
    );
    expect(onError.mock.calls[0][2]).toMatchObject({
      code: 'id_token_unverifiable',
      statusCode: 502,
    });
  });
});
