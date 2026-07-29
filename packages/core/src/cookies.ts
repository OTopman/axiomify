import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AxiomifyRequest, AxiomifyResponse } from './types';

/**
 * Cookie primitives shared by adapters and plugins.
 *
 * Core deliberately ships only the parsing / serialisation / signing layer.
 * Transport concerns (emitting multiple `Set-Cookie` lines) live in the
 * adapters via the optional `res.cookie()` / `res.clearCookie()` methods;
 * session semantics live in `@axiomify/session`.
 */

export interface CookieOptions {
  /** `Domain=` attribute. Omitted by default (host-only cookie). */
  domain?: string;
  /** `Path=` attribute. Defaults to `/`. */
  path?: string;
  /** `Expires=` attribute. Mutually composable with maxAge (both emitted). */
  expires?: Date;
  /** `Max-Age=` attribute, in seconds. Non-integer values are floored. */
  maxAge?: number;
  /** `HttpOnly` flag. Defaults to true — opt out explicitly. */
  httpOnly?: boolean;
  /** `Secure` flag. Required (and auto-set) when sameSite is 'none'. */
  secure?: boolean;
  /** `SameSite=` attribute. Defaults to 'lax'. */
  sameSite?: 'strict' | 'lax' | 'none';
  /** CHIPS `Partitioned` flag (requires secure). */
  partitioned?: boolean;
  /** `Priority=` attribute (Chrome extension). */
  priority?: 'low' | 'medium' | 'high';
}

// RFC 6265 cookie-name = token (RFC 9110 §5.6.2). Anything outside token
// characters is rejected outright — no percent-encoding fallback for names.
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// RFC 6265 cookie-value chars (excluding DQUOTE, comma, semicolon, backslash,
// whitespace and control chars). Values outside this set are URI-encoded.
const COOKIE_VALUE_PATTERN = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

/**
 * Parse a `Cookie:` request header into a name → value record.
 *
 * - First occurrence of a name wins (matches Express / Fastify behaviour and
 *   defuses cookie-shadowing tricks where an attacker appends a duplicate).
 * - Values are URI-decoded when they contain `%`; malformed encodings are
 *   kept verbatim rather than throwing.
 * - Quoted values (`name="value"`) are unquoted per RFC 6265 §4.1.1.
 */
export function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;

  let start = 0;
  const len = header.length;
  while (start < len) {
    let end = header.indexOf(';', start);
    if (end === -1) end = len;

    const eq = header.indexOf('=', start);
    if (eq !== -1 && eq < end) {
      const name = header.slice(start, eq).trim();
      if (name && out[name] === undefined) {
        let value = header.slice(eq + 1, end).trim();
        if (
          value.length >= 2 &&
          value.charCodeAt(0) === 34 /* " */ &&
          value.charCodeAt(value.length - 1) === 34
        ) {
          value = value.slice(1, -1);
        }
        if (value.includes('%')) {
          try {
            value = decodeURIComponent(value);
          } catch {
            /* malformed encoding — keep raw value */
          }
        }
        out[name] = value;
      }
    }
    start = end + 1;
  }
  return out;
}

/**
 * Serialise a cookie to a `Set-Cookie` header value.
 *
 * Secure-by-default: `HttpOnly` and `SameSite=Lax` unless overridden.
 * Throws on invalid names, control characters in attribute values, and
 * `SameSite=None` without `Secure` (browsers reject that combination).
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new Error(
      `[Axiomify] Invalid cookie name "${name}". Cookie names must be RFC 6265 tokens.`,
    );
  }

  const encoded = COOKIE_VALUE_PATTERN.test(value)
    ? value
    : encodeURIComponent(value);

  let out = `${name}=${encoded}`;

  const sameSite = options.sameSite ?? 'lax';
  // SameSite=None requires Secure per the browser spec; auto-upgrading
  // silently would mask a misconfiguration, so we throw unless secure
  // was left unset (in which case we set it — the only valid combination).
  let secure = options.secure;
  if (sameSite === 'none') {
    if (secure === false) {
      throw new Error(
        '[Axiomify] SameSite=None cookies must be Secure. Browsers reject them otherwise.',
      );
    }
    secure = true;
  }

  if (options.domain) {
    assertCookieAttr('Domain', options.domain);
    out += `; Domain=${options.domain}`;
  }
  const path = options.path ?? '/';
  assertCookieAttr('Path', path);
  out += `; Path=${path}`;

  if (options.expires) {
    if (Number.isNaN(options.expires.getTime())) {
      throw new Error('[Axiomify] Cookie "expires" is an invalid Date.');
    }
    out += `; Expires=${options.expires.toUTCString()}`;
  }
  if (options.maxAge !== undefined) {
    if (!Number.isFinite(options.maxAge)) {
      throw new Error('[Axiomify] Cookie "maxAge" must be a finite number.');
    }
    out += `; Max-Age=${Math.floor(options.maxAge)}`;
  }
  if (options.httpOnly ?? true) out += '; HttpOnly';
  if (secure) out += '; Secure';
  out += `; SameSite=${sameSite === 'strict' ? 'Strict' : sameSite === 'lax' ? 'Lax' : 'None'}`;
  if (options.partitioned) {
    if (!secure) {
      throw new Error('[Axiomify] Partitioned cookies must be Secure.');
    }
    out += '; Partitioned';
  }
  if (options.priority) {
    out += `; Priority=${options.priority[0].toUpperCase()}${options.priority.slice(1)}`;
  }
  return out;
}

function assertCookieAttr(attr: string, value: string): void {
  // CR/LF/semicolon in attribute values would break out of the Set-Cookie
  // line — same response-splitting class the native adapter guards against.
  if (/[;\r\n\0]/.test(value)) {
    throw new Error(
      `[Axiomify] Cookie ${attr} attribute contains illegal characters.`,
    );
  }
}

// ─── Signing ─────────────────────────────────────────────────────────────────
//
// Format: `s:<value>.<base64url hmac-sha256>` — compatible with the widely
// deployed cookie-signature format so sessions can migrate from Express.

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/** Sign a cookie value with HMAC-SHA256. */
export function signCookieValue(value: string, secret: string): string {
  if (!secret) throw new Error('[Axiomify] Cookie signing secret is empty.');
  return `s:${value}.${hmac(value, secret)}`;
}

export interface UnsignResult {
  valid: boolean;
  /** The original value when valid; undefined otherwise. */
  value?: string;
}

/**
 * Verify a signed cookie value against one or more secrets.
 *
 * Accepts an array to support zero-downtime secret rotation: sign with
 * `secrets[0]`, verify against all. Comparison is constant-time.
 */
export function unsignCookieValue(
  signed: string,
  secrets: string | string[],
): UnsignResult {
  if (!signed.startsWith('s:')) return { valid: false };
  const dot = signed.lastIndexOf('.');
  // `dot === 2` is NOT malformed — it's `signCookieValue('', secret)`, whose
  // format is `s:` + `.` + mac, placing the separator immediately after the
  // "s:" prefix. Only reject when no separator exists at all (dot === -1;
  // dot can't legitimately land on 0 or 1, since those indices are "s:").
  if (dot < 2) return { valid: false };

  const value = signed.slice(2, dot);
  const givenMac = signed.slice(dot + 1);
  const list = Array.isArray(secrets) ? secrets : [secrets];

  for (const secret of list) {
    if (!secret) continue;
    const expected = hmac(value, secret);
    const a = Buffer.from(givenMac);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { valid: true, value };
    }
  }
  return { valid: false };
}

// ─── Request/response helpers ────────────────────────────────────────────────

// Parsed-cookie cache. WeakMap keyed on the request object so the parse cost
// is paid at most once per request regardless of how many plugins ask.
const parsedCookies = new WeakMap<object, Record<string, string>>();

/**
 * Read the parsed cookies for a request. Works on every adapter — reads the
 * `Cookie` header directly and memoises per request object.
 */
export function getCookies(req: AxiomifyRequest): Record<string, string> {
  const key = req as unknown as object;
  let cookies = parsedCookies.get(key);
  if (!cookies) {
    const header = req.headers['cookie'];
    cookies = parseCookieHeader(
      typeof header === 'string' ? header : (header?.[0] ?? ''),
    );
    parsedCookies.set(key, cookies);
  }
  return cookies;
}

/**
 * Set a cookie on any adapter's response.
 *
 * Prefers the adapter's native multi-cookie support (`res.cookie()`); falls
 * back to a single `Set-Cookie` header for adapters that predate it — in
 * that fallback, setting a second cookie throws instead of silently
 * overwriting the first.
 */
export function setCookie(
  res: AxiomifyResponse,
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  if (typeof res.cookie === 'function') {
    res.cookie(name, value, options);
    return;
  }
  if (res.getHeader('Set-Cookie') !== undefined) {
    throw new Error(
      '[Axiomify] This adapter does not implement res.cookie() and a ' +
        'Set-Cookie header is already present. Multiple cookies require ' +
        'adapter support (upgrade @axiomify/native or @axiomify/serverless).',
    );
  }
  res.header('Set-Cookie', serializeCookie(name, value, options));
}

/**
 * Expire a cookie. Attributes (domain/path) must match the original cookie
 * for browsers to remove it.
 */
export function clearCookie(
  res: AxiomifyResponse,
  name: string,
  options?: Pick<CookieOptions, 'domain' | 'path' | 'secure' | 'sameSite'>,
): void {
  if (typeof res.clearCookie === 'function') {
    res.clearCookie(name, options);
    return;
  }
  setCookie(res, name, '', { ...options, expires: new Date(0), maxAge: 0 });
}
