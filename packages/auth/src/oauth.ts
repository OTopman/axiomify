/**
 * OAuth 2.0 / OIDC Authorization Code flow with PKCE for Axiomify.
 *
 * Design decisions (security-first):
 * - PKCE (RFC 7636) is ALWAYS on with the S256 method — never `plain`.
 * - `state` + PKCE `code_verifier` (+ OIDC `nonce`) live server-side of the
 *   browser in a short-lived signed cookie (HMAC-SHA256 via core's
 *   signCookieValue), HttpOnly + SameSite=Lax, default max age 600 s.
 * - The state comparison is constant-time.
 * - ID tokens are verified via the JWKS client (issuer, audience = clientId,
 *   exp and nonce) with an asymmetric-only allowlist — an ID token can never
 *   be accepted on the word of the token endpoint alone.
 * - OIDC discovery documents are fetched once per plugin instance and cached
 *   (default 1 hour); endpoint URLs from discovery must be https.
 */
import {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteMiddleware,
  clearCookie,
  getCookies,
  setCookie,
  signCookieValue,
  unsignCookieValue,
} from '@axiomify/core';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { JwksClient } from './jwks';
import type { JwtClaims } from './jwt';
import { verifyJwt } from './jwt';

export type OAuthProvider = 'google' | 'github' | 'auth0' | 'oidc';

export interface OAuthEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Profile endpoint (OIDC userinfo, or e.g. GitHub's /user). */
  userinfoEndpoint?: string;
  /** JWKS URL used to verify ID tokens. */
  jwksUri?: string;
  /** Expected `iss` of ID tokens. */
  issuer?: string | string[];
}

export interface OAuthPluginOptions {
  provider: OAuthProvider;
  /**
   * OIDC issuer base URL. Required for `auth0` and `oidc` — endpoints are
   * discovered from `<issuer>/.well-known/openid-configuration`.
   */
  issuer?: string;
  /** Manual endpoint overrides (win over presets and discovery). */
  endpoints?: Partial<OAuthEndpoints>;
  clientId: string;
  /** Optional for public PKCE-only clients. */
  clientSecret?: string;
  /** Absolute redirect/callback URL registered with the provider. */
  redirectUri: string;
  /** Defaults: google/auth0/oidc → openid profile email; github → read:user. */
  scopes?: string[];
  /** Secret (≥ 32 bytes) signing the state cookie. */
  cookieSecret: string;
  /** State cookie name. Default `axiomify_oauth`. */
  cookieName?: string;
  /** Lifetime of the state cookie / auth attempt, seconds. Default 600. */
  stateTtlSeconds?: number;
  /**
   * Verify ID tokens via JWKS (default true). May only be disabled
   * explicitly — e.g. for a provider without a published JWKS.
   */
  verifyIdToken?: boolean;
  /** Clock leeway (seconds) for ID-token exp/nbf validation. Default 5. */
  clockTolerance?: number;
  /** Timeout for provider HTTP calls, ms. Default 10 000. */
  requestTimeoutMs?: number;
}

export interface OAuthTokens {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  idToken?: string;
  /** Verified ID-token claims (present when an ID token was verified). */
  idTokenClaims?: JwtClaims;
  scope?: string;
  /** Full token-endpoint response body. */
  raw: Record<string, unknown>;
}

export interface OAuthResult {
  tokens: OAuthTokens;
  /** Userinfo/profile document, or verified ID-token claims as fallback. */
  profile: Record<string, unknown> | null;
}

export type OAuthSuccessHandler = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
  result: OAuthResult,
) => void | Promise<void>;

export type OAuthErrorHandler = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
  error: OAuthError,
) => void | Promise<void>;

export interface OAuthPlugin {
  /** GET handler that 302-redirects to the provider's authorization page. */
  authorizeHandler: RouteMiddleware;
  /** Build the callback route handler. */
  callbackHandler(
    onSuccess: OAuthSuccessHandler,
    onError?: OAuthErrorHandler,
  ): RouteMiddleware;
}

/** All OAuth flow failures are raised as this type. */
export class OAuthError extends Error {
  readonly statusCode: number;
  /** Stable machine-readable code, e.g. `state_mismatch`. */
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ─── Provider presets ────────────────────────────────────────────────────────

interface ProviderPreset {
  endpoints: OAuthEndpoints;
  defaultScopes: string[];
  oidc: boolean;
}

const PRESETS: Partial<Record<OAuthProvider, ProviderPreset>> = {
  google: {
    endpoints: {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
      jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
      // Google historically issues both forms.
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    },
    defaultScopes: ['openid', 'profile', 'email'],
    oidc: true,
  },
  github: {
    endpoints: {
      authorizationEndpoint: 'https://github.com/login/oauth/authorize',
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      userinfoEndpoint: 'https://api.github.com/user',
    },
    defaultScopes: ['read:user'],
    oidc: false,
  },
};

const DISCOVERY_TTL_MS = 3_600_000;
const MIN_COOKIE_SECRET_BYTES = 32;

interface StatePayload {
  state: string;
  verifier: string;
  nonce?: string;
  iat: number;
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data as Buffer).toString('base64url');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Length leak is fine: state values are non-secret random nonces; what
  // matters is that content comparison is not an incremental oracle.
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function queryParam(req: AxiomifyRequest, name: string): string | undefined {
  const q = req.query as Record<string, unknown> | undefined;
  if (q && typeof q === 'object') {
    const v = (q as Record<string, unknown>)[name];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  // Fallback for adapters that do not pre-parse the query string.
  const url = req.url ?? '';
  const qs = url.indexOf('?');
  if (qs === -1) return undefined;
  return new URLSearchParams(url.slice(qs + 1)).get(name) ?? undefined;
}

/** Create an OAuth 2.0 / OIDC Authorization Code (+PKCE) plugin. */
export function createOAuthPlugin(options: OAuthPluginOptions): OAuthPlugin {
  if (!options?.provider) {
    throw new Error('[axiomify/auth] createOAuthPlugin requires `provider`');
  }
  if (!options.clientId) {
    throw new Error('[axiomify/auth] createOAuthPlugin requires `clientId`');
  }
  if (!options.redirectUri || !/^https?:\/\//.test(options.redirectUri)) {
    throw new Error(
      '[axiomify/auth] createOAuthPlugin requires an absolute `redirectUri`',
    );
  }
  if (
    !options.cookieSecret ||
    Buffer.byteLength(options.cookieSecret, 'utf8') < MIN_COOKIE_SECRET_BYTES
  ) {
    throw new Error(
      `[axiomify/auth] createOAuthPlugin \`cookieSecret\` must be at least ${MIN_COOKIE_SECRET_BYTES} bytes`,
    );
  }
  const preset = PRESETS[options.provider];
  const needsDiscovery = !preset;
  const issuer = options.issuer?.replace(/\/+$/, '');
  if (needsDiscovery && !issuer && !options.endpoints?.authorizationEndpoint) {
    throw new Error(
      `[axiomify/auth] provider "${options.provider}" requires \`issuer\` (for OIDC discovery) or explicit \`endpoints\``,
    );
  }
  const isOidc = preset ? preset.oidc : true;
  const scopes =
    options.scopes ??
    preset?.defaultScopes ??
    ['openid', 'profile', 'email'];
  const cookieName = options.cookieName ?? 'axiomify_oauth';
  const stateTtl = options.stateTtlSeconds ?? 600;
  const timeoutMs = options.requestTimeoutMs ?? 10_000;
  const verifyIdTokens = options.verifyIdToken ?? true;
  const secureCookies = options.redirectUri.startsWith('https://');

  // ── Endpoint resolution (preset → discovery → manual overrides) ──────────
  let discovered: { endpoints: OAuthEndpoints; fetchedAt: number } | null =
    null;
  let discoveryInflight: Promise<OAuthEndpoints> | null = null;

  async function discover(): Promise<OAuthEndpoints> {
    const url = `${issuer}/.well-known/openid-configuration`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new OAuthError(
        503,
        'discovery_failed',
        `OIDC discovery failed for ${url}: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!response.ok) {
      throw new OAuthError(
        503,
        'discovery_failed',
        `OIDC discovery endpoint ${url} responded ${response.status}`,
      );
    }
    const doc = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !doc ||
      typeof doc.authorization_endpoint !== 'string' ||
      typeof doc.token_endpoint !== 'string'
    ) {
      throw new OAuthError(
        503,
        'discovery_failed',
        `OIDC discovery document from ${url} is missing required endpoints`,
      );
    }
    return {
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      userinfoEndpoint:
        typeof doc.userinfo_endpoint === 'string'
          ? doc.userinfo_endpoint
          : undefined,
      jwksUri: typeof doc.jwks_uri === 'string' ? doc.jwks_uri : undefined,
      issuer: typeof doc.issuer === 'string' ? doc.issuer : issuer,
    };
  }

  async function resolveEndpoints(): Promise<OAuthEndpoints> {
    let base: OAuthEndpoints;
    if (preset) {
      base = preset.endpoints;
    } else if (
      options.endpoints?.authorizationEndpoint &&
      options.endpoints?.tokenEndpoint
    ) {
      base = options.endpoints as OAuthEndpoints;
    } else {
      const fresh =
        discovered && Date.now() - discovered.fetchedAt < DISCOVERY_TTL_MS;
      if (!fresh) {
        if (!discoveryInflight) {
          discoveryInflight = discover().finally(() => {
            discoveryInflight = null;
          });
        }
        const endpoints = await discoveryInflight;
        discovered = { endpoints, fetchedAt: Date.now() };
      }
      base = discovered!.endpoints;
    }
    return { ...base, ...options.endpoints };
  }

  // ── ID-token verification ────────────────────────────────────────────────
  let jwksClient: JwksClient | null = null;

  async function verifyIdTokenClaims(
    idToken: string,
    endpoints: OAuthEndpoints,
    expectedNonce: string | undefined,
  ): Promise<JwtClaims> {
    if (!endpoints.jwksUri) {
      throw new OAuthError(
        502,
        'id_token_unverifiable',
        'Provider returned an ID token but no JWKS URI is known. ' +
          'Configure `endpoints.jwksUri` or set `verifyIdToken: false` explicitly.',
      );
    }
    if (!jwksClient || (jwksClient as any).url !== endpoints.jwksUri) {
      jwksClient = new JwksClient({
        url: endpoints.jwksUri,
        requestTimeoutMs: timeoutMs,
      });
    }
    let claims: JwtClaims;
    try {
      claims = await verifyJwt(idToken, {
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'],
        keyResolver: jwksClient,
        ...(endpoints.issuer ? { issuer: endpoints.issuer } : {}),
        audience: options.clientId,
        clockTolerance: options.clockTolerance ?? 5,
      });
    } catch (err) {
      throw new OAuthError(
        401,
        'invalid_id_token',
        `ID token verification failed: ${(err as Error)?.message ?? err}`,
      );
    }
    if (expectedNonce !== undefined) {
      if (
        typeof claims.nonce !== 'string' ||
        !timingSafeStringEqual(claims.nonce, expectedNonce)
      ) {
        throw new OAuthError(
          401,
          'nonce_mismatch',
          'ID token nonce does not match the value from this authorization request',
        );
      }
    }
    return claims;
  }

  // ── State cookie ─────────────────────────────────────────────────────────
  function readStateCookie(req: AxiomifyRequest): StatePayload {
    const raw = getCookies(req)[cookieName];
    if (!raw) {
      throw new OAuthError(
        400,
        'missing_state_cookie',
        'Missing OAuth state cookie — start the flow at the authorize URL',
      );
    }
    const unsigned = unsignCookieValue(raw, options.cookieSecret);
    if (!unsigned.valid || !unsigned.value) {
      throw new OAuthError(
        400,
        'invalid_state_cookie',
        'OAuth state cookie signature is invalid',
      );
    }
    let payload: StatePayload;
    try {
      payload = JSON.parse(
        Buffer.from(unsigned.value, 'base64url').toString('utf8'),
      ) as StatePayload;
    } catch {
      throw new OAuthError(
        400,
        'invalid_state_cookie',
        'OAuth state cookie payload is malformed',
      );
    }
    if (
      typeof payload?.state !== 'string' ||
      typeof payload?.verifier !== 'string' ||
      typeof payload?.iat !== 'number'
    ) {
      throw new OAuthError(
        400,
        'invalid_state_cookie',
        'OAuth state cookie payload is malformed',
      );
    }
    if (Math.floor(Date.now() / 1000) - payload.iat > stateTtl) {
      throw new OAuthError(
        400,
        'state_expired',
        'OAuth login attempt expired — start the flow again',
      );
    }
    return payload;
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  const authorizeHandler: RouteMiddleware = async (req, res) => {
    const endpoints = await resolveEndpoints();
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url'); // 43 chars, RFC 7636 §4.1
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const nonce = isOidc ? randomBytes(16).toString('base64url') : undefined;

    const payload: StatePayload = {
      state,
      verifier,
      ...(nonce ? { nonce } : {}),
      iat: Math.floor(Date.now() / 1000),
    };
    setCookie(
      res,
      cookieName,
      signCookieValue(b64url(JSON.stringify(payload)), options.cookieSecret),
      {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: stateTtl,
        secure: secureCookies,
      },
    );

    const url = new URL(endpoints.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', options.clientId);
    url.searchParams.set('redirect_uri', options.redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (nonce) url.searchParams.set('nonce', nonce);

    res.status(302).header('Location', url.toString()).send(null);
  };

  async function exchangeCode(
    endpoints: OAuthEndpoints,
    code: string,
    verifier: string,
  ): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: options.redirectUri,
      client_id: options.clientId,
      code_verifier: verifier,
    });
    if (options.clientSecret) body.set('client_secret', options.clientSecret);

    let response: Response;
    try {
      response = await fetch(endpoints.tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json', // GitHub returns form-encoded otherwise
        },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new OAuthError(
        502,
        'token_exchange_failed',
        `Token exchange request failed: ${(err as Error)?.message ?? err}`,
      );
    }
    const json = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok || !json || typeof json.error === 'string') {
      const detail =
        json && typeof json.error === 'string'
          ? ` (${json.error})`
          : '';
      throw new OAuthError(
        502,
        'token_exchange_failed',
        `Token exchange failed with status ${response.status}${detail}`,
      );
    }
    if (typeof json.access_token !== 'string' || !json.access_token) {
      throw new OAuthError(
        502,
        'token_exchange_failed',
        'Token endpoint response is missing access_token',
      );
    }
    return {
      accessToken: json.access_token,
      tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
      refreshToken:
        typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      idToken: typeof json.id_token === 'string' ? json.id_token : undefined,
      scope: typeof json.scope === 'string' ? json.scope : undefined,
      raw: json,
    };
  }

  async function fetchProfile(
    endpoints: OAuthEndpoints,
    tokens: OAuthTokens,
  ): Promise<Record<string, unknown> | null> {
    if (!endpoints.userinfoEndpoint) {
      return (tokens.idTokenClaims as Record<string, unknown>) ?? null;
    }
    let response: Response;
    try {
      response = await fetch(endpoints.userinfoEndpoint, {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          accept: 'application/json',
          'user-agent': 'axiomify-auth', // required by api.github.com
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new OAuthError(
        502,
        'userinfo_failed',
        `Userinfo request failed: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!response.ok) {
      throw new OAuthError(
        502,
        'userinfo_failed',
        `Userinfo endpoint responded ${response.status}`,
      );
    }
    const profile = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!profile || typeof profile !== 'object') {
      throw new OAuthError(
        502,
        'userinfo_failed',
        'Userinfo endpoint returned an invalid document',
      );
    }
    return profile;
  }

  function callbackHandler(
    onSuccess: OAuthSuccessHandler,
    onError?: OAuthErrorHandler,
  ): RouteMiddleware {
    if (typeof onSuccess !== 'function') {
      throw new Error(
        '[axiomify/auth] callbackHandler requires an onSuccess(req, res, { tokens, profile }) function',
      );
    }
    return async (req, res) => {
      try {
        const providerError = queryParam(req, 'error');
        if (providerError) {
          const description = queryParam(req, 'error_description');
          throw new OAuthError(
            400,
            'provider_error',
            `Provider returned error "${providerError}"${description ? `: ${description}` : ''}`,
          );
        }
        const code = queryParam(req, 'code');
        const returnedState = queryParam(req, 'state');
        if (!code || !returnedState) {
          throw new OAuthError(
            400,
            'missing_parameters',
            'OAuth callback is missing the `code` or `state` query parameter',
          );
        }

        const stored = readStateCookie(req);
        // One-shot: expire the cookie regardless of outcome below.
        clearCookie(res, cookieName, {
          path: '/',
          sameSite: 'lax',
          secure: secureCookies,
        });

        if (!timingSafeStringEqual(stored.state, returnedState)) {
          throw new OAuthError(
            400,
            'state_mismatch',
            'OAuth state mismatch — possible CSRF, aborting',
          );
        }

        const endpoints = await resolveEndpoints();
        const tokens = await exchangeCode(endpoints, code, stored.verifier);

        if (tokens.idToken && verifyIdTokens) {
          tokens.idTokenClaims = await verifyIdTokenClaims(
            tokens.idToken,
            endpoints,
            stored.nonce,
          );
        }

        const profile = await fetchProfile(endpoints, tokens);
        await onSuccess(req, res, { tokens, profile });
      } catch (err) {
        const error =
          err instanceof OAuthError
            ? err
            : new OAuthError(
                500,
                'internal_error',
                (err as Error)?.message ?? 'OAuth callback failed',
              );
        if (onError) {
          await onError(req, res, error);
          return;
        }
        res.status(error.statusCode).send(null, error.message);
      }
    };
  }

  return { authorizeHandler, callbackHandler };
}
