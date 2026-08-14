import { signCookieValue, unsignCookieValue } from '@axiomify/core';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthPlugin, OAuthError } from '../src/index';

const COOKIE_SECRET = 'oauth-state-cookie-secret-at-least-32-bytes-long!';
const COOKIE_NAME = 'axiomify_oauth';

function makeRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    cookies: [] as Array<{ name: string; value: string; options?: any }>,
    cleared: [] as Array<{ name: string; options?: any }>,
    headers,
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    header: vi.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
      return res;
    }),
    getHeader: (name: string) => headers[name.toLowerCase()],
    cookie: vi.fn((name: string, value: string, options?: any) => {
      res.cookies.push({ name, value, options });
      return res;
    }),
    clearCookie: vi.fn((name: string, options?: any) => {
      res.cleared.push({ name, options });
      return res;
    }),
  };
  return res;
}

function makeReq(
  query: Record<string, string> = {},
  cookieHeader?: string,
): any {
  return {
    method: 'GET',
    path: '/auth/callback',
    url: '/auth/callback',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    query,
    params: {},
    state: {},
    id: 'req-1',
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

interface StatePayload {
  state: string;
  verifier: string;
  nonce?: string;
  iat: number;
}

/** Run authorizeHandler and return the redirect URL + decoded state cookie. */
async function startFlow(plugin: ReturnType<typeof createOAuthPlugin>) {
  const res = makeRes();
  await plugin.authorizeHandler(makeReq(), res);
  const location = new URL(res.headers['location']);
  const cookie = res.cookies.find((c: any) => c.name === COOKIE_NAME)!;
  const unsigned = unsignCookieValue(cookie.value, COOKIE_SECRET);
  const payload = JSON.parse(
    Buffer.from(unsigned.value!, 'base64url').toString('utf8'),
  ) as StatePayload;
  return { res, location, cookie, payload };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const githubOptions = {
  provider: 'github' as const,
  clientId: 'gh-client-id',
  clientSecret: 'gh-client-secret',
  redirectUri: 'https://app.example.com/auth/callback',
  cookieSecret: COOKIE_SECRET,
};

describe('createOAuthPlugin — authorizeHandler', () => {
  it('302-redirects to the GitHub preset endpoint with PKCE S256 parameters', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const { res, location, payload } = await startFlow(plugin);

    expect(res.status).toHaveBeenCalledWith(302);
    expect(location.origin + location.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe('gh-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/auth/callback',
    );
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBe(payload.state);

    // code_challenge must be base64url(sha256(verifier)).
    const expectedChallenge = createHash('sha256')
      .update(payload.verifier)
      .digest('base64url');
    expect(location.searchParams.get('code_challenge')).toBe(expectedChallenge);

    // GitHub is plain OAuth2, not OIDC — no nonce anywhere.
    expect(location.searchParams.get('nonce')).toBeNull();
    expect(payload.nonce).toBeUndefined();
  });

  it('sets a signed, HttpOnly, SameSite=Lax state cookie', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const { cookie, payload } = await startFlow(plugin);

    expect(cookie.value.startsWith('s:')).toBe(true);
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
      secure: true, // https redirectUri
    });
    expect(typeof payload.iat).toBe('number');
    expect(payload.verifier.length).toBeGreaterThanOrEqual(43); // RFC 7636 §4.1
  });

  it('google preset uses the Google endpoints, OIDC scopes and a nonce', async () => {
    const plugin = createOAuthPlugin({
      ...githubOptions,
      provider: 'google',
      clientId: 'google-client-id',
    });
    const { location, payload } = await startFlow(plugin);

    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(location.searchParams.get('scope')).toBe('openid profile email');
    expect(location.searchParams.get('nonce')).toBe(payload.nonce);
    expect(payload.nonce).toBeTruthy();
  });
});

describe('createOAuthPlugin — callbackHandler happy path (github)', () => {
  it('exchanges the code with PKCE, fetches the profile and calls onSuccess', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const { cookie, payload } = await startFlow(plugin);

    const fetchCalls: Array<{ url: string; init: any }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init: any) => {
        fetchCalls.push({ url: String(url), init });
        if (String(url) === 'https://github.com/login/oauth/access_token') {
          return jsonResponse({
            access_token: 'gh-access-token',
            token_type: 'bearer',
            scope: 'read:user',
          });
        }
        if (String(url) === 'https://api.github.com/user') {
          return jsonResponse({ login: 'octocat', id: 42 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const onSuccess = vi.fn();
    const req = makeReq(
      { code: 'the-auth-code', state: payload.state },
      `${COOKIE_NAME}=${cookie.value}`,
    );
    const res = makeRes();
    await plugin.callbackHandler(onSuccess)(req, res);

    // Token exchange request body.
    const tokenCall = fetchCalls[0];
    expect(tokenCall.url).toBe('https://github.com/login/oauth/access_token');
    expect(tokenCall.init.method).toBe('POST');
    expect(tokenCall.init.headers['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(tokenCall.init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-auth-code');
    expect(body.get('redirect_uri')).toBe(
      'https://app.example.com/auth/callback',
    );
    expect(body.get('client_id')).toBe('gh-client-id');
    expect(body.get('client_secret')).toBe('gh-client-secret');
    expect(body.get('code_verifier')).toBe(payload.verifier);

    // Userinfo request carries the access token.
    const userinfoCall = fetchCalls[1];
    expect(userinfoCall.url).toBe('https://api.github.com/user');
    expect(userinfoCall.init.headers.authorization).toBe(
      'Bearer gh-access-token',
    );

    // onSuccess receives tokens + profile; the one-shot cookie was cleared.
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const [, , result] = onSuccess.mock.calls[0];
    expect(result.tokens.accessToken).toBe('gh-access-token');
    expect(result.tokens.tokenType).toBe('bearer');
    expect(result.profile).toEqual({ login: 'octocat', id: 42 });
    expect(res.cleared).toContainEqual(
      expect.objectContaining({ name: COOKIE_NAME }),
    );
    expect(res.status).not.toHaveBeenCalledWith(expect.any(Number));
  });
});

describe('createOAuthPlugin — callbackHandler error paths', () => {
  it('rejects a state mismatch without contacting the token endpoint', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const { cookie } = await startFlow(plugin);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const onSuccess = vi.fn();
    const onError = vi.fn();
    const req = makeReq(
      { code: 'c', state: 'attacker-forged-state' },
      `${COOKIE_NAME}=${cookie.value}`,
    );
    const res = makeRes();
    await plugin.callbackHandler(onSuccess, onError)(req, res);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const error = onError.mock.calls[0][2] as OAuthError;
    expect(error).toBeInstanceOf(OAuthError);
    expect(error.code).toBe('state_mismatch');
    expect(error.statusCode).toBe(400);
    // Cookie is one-shot: cleared even on failure.
    expect(res.cleared).toContainEqual(
      expect.objectContaining({ name: COOKIE_NAME }),
    );
  });

  it('rejects a missing state cookie with 400 (default error response)', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const res = makeRes();
    await plugin.callbackHandler(vi.fn())(
      makeReq({ code: 'c', state: 's' }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      null,
      expect.stringMatching(/state cookie/),
    );
  });

  it('rejects a tampered state cookie', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const { cookie, payload } = await startFlow(plugin);
    const tampered =
      cookie.value.slice(0, -1) + (cookie.value.endsWith('A') ? 'B' : 'A');

    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      makeReq(
        { code: 'c', state: payload.state },
        `${COOKIE_NAME}=${tampered}`,
      ),
      makeRes(),
    );
    expect((onError.mock.calls[0][2] as OAuthError).code).toBe(
      'invalid_state_cookie',
    );
  });

  it('rejects an expired state cookie', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const stale: StatePayload = {
      state: 'st',
      verifier: 'v'.repeat(43),
      iat: Math.floor(Date.now() / 1000) - 700, // beyond the 600 s TTL
    };
    const value = signCookieValue(
      Buffer.from(JSON.stringify(stale)).toString('base64url'),
      COOKIE_SECRET,
    );
    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      makeReq({ code: 'c', state: 'st' }, `${COOKIE_NAME}=${value}`),
      makeRes(),
    );
    expect((onError.mock.calls[0][2] as OAuthError).code).toBe('state_expired');
  });

  it('surfaces a token-endpoint 400 as token_exchange_failed (502)', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const { cookie, payload } = await startFlow(plugin);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400)),
    );

    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      makeReq(
        { code: 'bad-code', state: payload.state },
        `${COOKIE_NAME}=${cookie.value}`,
      ),
      makeRes(),
    );
    const error = onError.mock.calls[0][2] as OAuthError;
    expect(error.code).toBe('token_exchange_failed');
    expect(error.statusCode).toBe(502);
    expect(error.message).toMatch(/invalid_grant/);
  });

  it('maps provider error query params to provider_error', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(
      makeReq({ error: 'access_denied', error_description: 'user said no' }),
      makeRes(),
    );
    const error = onError.mock.calls[0][2] as OAuthError;
    expect(error.code).toBe('provider_error');
    expect(error.message).toMatch(/access_denied/);
    expect(error.message).toMatch(/user said no/);
  });

  it('rejects callbacks missing code or state', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const onError = vi.fn();
    await plugin.callbackHandler(vi.fn(), onError)(makeReq({}), makeRes());
    expect((onError.mock.calls[0][2] as OAuthError).code).toBe(
      'missing_parameters',
    );
  });

  it('wraps onSuccess exceptions as internal_error (500)', async () => {
    const plugin = createOAuthPlugin(githubOptions);
    const { cookie, payload } = await startFlow(plugin);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).includes('access_token')
          ? jsonResponse({ access_token: 'at' })
          : jsonResponse({ login: 'octocat' }),
      ),
    );

    const onError = vi.fn();
    await plugin.callbackHandler(() => {
      throw new Error('handler blew up');
    }, onError)(
      makeReq(
        { code: 'c', state: payload.state },
        `${COOKIE_NAME}=${cookie.value}`,
      ),
      makeRes(),
    );
    const error = onError.mock.calls[0][2] as OAuthError;
    expect(error.code).toBe('internal_error');
    expect(error.statusCode).toBe(500);
  });
});

describe('createOAuthPlugin — OIDC discovery', () => {
  const DISCOVERY_URL =
    'https://id.example.com/.well-known/openid-configuration';
  const discoveryDoc = {
    issuer: 'https://id.example.com',
    authorization_endpoint: 'https://id.example.com/authorize',
    token_endpoint: 'https://id.example.com/token',
    userinfo_endpoint: 'https://id.example.com/userinfo',
    jwks_uri: 'https://id.example.com/jwks',
  };
  const oidcOptions = {
    provider: 'oidc' as const,
    issuer: 'https://id.example.com',
    clientId: 'oidc-client',
    redirectUri: 'https://app.example.com/auth/callback',
    cookieSecret: COOKIE_SECRET,
  };

  it('discovers endpoints once and caches them for subsequent calls', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe(DISCOVERY_URL);
      return jsonResponse(discoveryDoc);
    });
    vi.stubGlobal('fetch', fetchMock);
    const plugin = createOAuthPlugin(oidcOptions);

    const first = await startFlow(plugin);
    expect(first.location.origin + first.location.pathname).toBe(
      'https://id.example.com/authorize',
    );
    // OIDC flow carries a nonce.
    expect(first.location.searchParams.get('nonce')).toBe(first.payload.nonce);

    await startFlow(plugin);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached, no refetch
  });

  it('fails with discovery_failed (503) when the discovery endpoint errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 500)),
    );
    const plugin = createOAuthPlugin(oidcOptions);
    const err = await plugin
      .authorizeHandler(makeReq(), makeRes())
      ?.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe('discovery_failed');
    expect((err as OAuthError).statusCode).toBe(503);
  });

  it('rejects discovery documents missing required endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ issuer: 'https://id.example.com' })),
    );
    const plugin = createOAuthPlugin(oidcOptions);
    await expect(plugin.authorizeHandler(makeReq(), makeRes())).rejects.toThrow(
      /missing required endpoints/,
    );
  });
});

describe('createOAuthPlugin — option validation', () => {
  it('requires provider, clientId, an absolute redirectUri and a long cookieSecret', () => {
    expect(() => createOAuthPlugin({} as never)).toThrow(/requires `provider`/);
    expect(() => createOAuthPlugin({ ...githubOptions, clientId: '' })).toThrow(
      /requires `clientId`/,
    );
    expect(() =>
      createOAuthPlugin({ ...githubOptions, redirectUri: '/callback' }),
    ).toThrow(/absolute `redirectUri`/);
    expect(() =>
      createOAuthPlugin({ ...githubOptions, cookieSecret: 'short' }),
    ).toThrow(/at least 32 bytes/);
  });

  it('requires issuer or explicit endpoints for the generic oidc provider and trims issuer trailing slashes', () => {
    expect(() =>
      createOAuthPlugin({ ...githubOptions, provider: 'oidc' }),
    ).toThrow(/requires `issuer`/);

    const plugin = createOAuthPlugin({
      ...githubOptions,
      provider: 'oidc',
      issuer: 'https://auth.example.com///',
      endpoints: {
        authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
        tokenEndpoint: 'https://auth.example.com/oauth/token',
      },
    });
    expect(plugin).toBeDefined();
  });

  it('callbackHandler requires an onSuccess function', () => {
    const plugin = createOAuthPlugin(githubOptions);
    expect(() => plugin.callbackHandler(undefined as never)).toThrow(
      /requires an onSuccess/,
    );
  });
});
