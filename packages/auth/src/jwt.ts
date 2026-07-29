/**
 * Minimal, security-first JWT engine built on node:crypto.
 *
 * Exists alongside the `jsonwebtoken`-backed HS256 path in index.ts to add
 * RS256/RS384/RS512/ES256/ES384 support with an explicit per-call algorithm
 * allowlist and hard algorithm-confusion defences:
 *
 * - the token header `alg` MUST be in the caller's allowlist — `none` (any
 *   casing) is rejected unconditionally and can never be allowlisted;
 * - a public (asymmetric) key can never verify an HS* token, and a symmetric
 *   secret can never verify an RS* or ES* token — the key material's own type
 *   decides which algorithm family it may participate in;
 * - ES* signatures are the raw `r||s` JOSE format, handled via
 *   `dsaEncoding: 'ieee-p1363'` (never DER).
 */
import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  KeyObject,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'node:crypto';

export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'ES256'
  | 'ES384';

export type KeyInput = string | Buffer | KeyObject;

interface AlgorithmSpec {
  family: 'hmac' | 'rsa' | 'ec';
  hash: 'sha256' | 'sha384' | 'sha512';
  /** Required named curve for EC algorithms. */
  curve?: string;
}

const ALGORITHMS: Record<JwtAlgorithm, AlgorithmSpec> = {
  HS256: { family: 'hmac', hash: 'sha256' },
  HS384: { family: 'hmac', hash: 'sha384' },
  HS512: { family: 'hmac', hash: 'sha512' },
  RS256: { family: 'rsa', hash: 'sha256' },
  RS384: { family: 'rsa', hash: 'sha384' },
  RS512: { family: 'rsa', hash: 'sha512' },
  ES256: { family: 'ec', hash: 'sha256', curve: 'prime256v1' },
  ES384: { family: 'ec', hash: 'sha384', curve: 'secp384r1' },
};

export const SUPPORTED_JWT_ALGORITHMS = Object.freeze(
  Object.keys(ALGORITHMS) as JwtAlgorithm[],
);

/**
 * Error hierarchy mirroring jsonwebtoken's error names so the existing
 * plugin error → 401 mapping in index.ts works unchanged for both engines.
 */
export class JwtError extends Error {
  constructor(message: string, name = 'JsonWebTokenError') {
    super(message);
    this.name = name;
  }
}
export class JwtExpiredError extends JwtError {
  readonly expiredAt: Date;
  constructor(message: string, expiredAt: Date) {
    super(message, 'TokenExpiredError');
    this.expiredAt = expiredAt;
  }
}
export class JwtNotBeforeError extends JwtError {
  readonly date: Date;
  constructor(message: string, date: Date) {
    super(message, 'NotBeforeError');
    this.date = date;
  }
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  [claim: string]: unknown;
}

export interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
  [param: string]: unknown;
}

// ─── Encoding helpers ────────────────────────────────────────────────────────

const B64URL = /^[A-Za-z0-9_-]+$/;

function b64urlEncode(data: Buffer | string): string {
  return Buffer.from(data as Buffer).toString('base64url');
}

function b64urlDecode(segment: string, what: string): Buffer {
  if (!B64URL.test(segment)) {
    throw new JwtError(`Invalid JWT: ${what} is not valid base64url`);
  }
  return Buffer.from(segment, 'base64url');
}

function decodeJson(segment: string, what: string): Record<string, unknown> {
  const raw = b64urlDecode(segment, what); // throws its own, more precise error
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new JwtError(`Invalid JWT: ${what} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new JwtError(`Invalid JWT: ${what} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Decode header + payload WITHOUT verifying. Never trust the output. */
export function decodeJwt(token: string): {
  header: JwtHeader;
  payload: JwtClaims;
} {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    throw new JwtError('Invalid JWT: expected three dot-separated segments');
  }
  const header = decodeJson(parts[0], 'header') as unknown as JwtHeader;
  const payload = decodeJson(parts[1], 'payload') as JwtClaims;
  return { header, payload };
}

// ─── Key normalisation & confusion defence ──────────────────────────────────

const MIN_HMAC_SECRET_BYTES = 32;

function looksLikePem(value: string): boolean {
  return value.includes('-----BEGIN');
}

interface ResolvedKey {
  kind: 'secret' | 'public' | 'private';
  key: KeyObject;
}

function resolveKey(input: KeyInput, forSigning: boolean): ResolvedKey {
  if (input instanceof KeyObject) {
    if (input.type === 'secret') return { kind: 'secret', key: input };
    if (input.type === 'private') return { kind: 'private', key: input };
    return { kind: 'public', key: input };
  }
  if (typeof input === 'string' && looksLikePem(input)) {
    if (forSigning) {
      if (input.includes('PRIVATE KEY')) {
        return { kind: 'private', key: createPrivateKey(input) };
      }
      throw new JwtError('Signing requires a private key, got a public PEM');
    }
    if (input.includes('PRIVATE KEY')) {
      // Deriving the public key from a private key is safe for verification.
      return { kind: 'public', key: createPublicKey(createPrivateKey(input)) };
    }
    return { kind: 'public', key: createPublicKey(input) };
  }
  // Anything else (non-PEM string / Buffer) is symmetric secret material.
  const raw = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return { kind: 'secret', key: createSecretKey(raw) };
}

/**
 * Enforce that the resolved key material is allowed to participate in the
 * given algorithm. This is the algorithm-confusion firewall: HS* strictly
 * requires a symmetric secret, RS* and ES* strictly require the matching
 * asymmetric key type and curve.
 */
function assertKeyCompatible(
  alg: JwtAlgorithm,
  resolved: ResolvedKey,
  forSigning: boolean,
): void {
  const spec = ALGORITHMS[alg];
  if (spec.family === 'hmac') {
    if (resolved.kind !== 'secret') {
      throw new JwtError(
        `Algorithm confusion blocked: ${alg} requires a symmetric secret, ` +
          `but ${resolved.kind} key material was provided`,
      );
    }
    const len = resolved.key.symmetricKeySize ?? 0;
    if (len < MIN_HMAC_SECRET_BYTES) {
      throw new JwtError(
        `${alg} secret is ${len} bytes; RFC 7518 §3.2 requires at least ` +
          `${MIN_HMAC_SECRET_BYTES} bytes (256 bits)`,
      );
    }
    return;
  }
  if (resolved.kind === 'secret') {
    throw new JwtError(
      `Algorithm confusion blocked: ${alg} requires an asymmetric key, ` +
        'but a symmetric secret was provided',
    );
  }
  if (forSigning && resolved.kind !== 'private') {
    throw new JwtError(`Signing with ${alg} requires a private key`);
  }
  const keyType = resolved.key.asymmetricKeyType;
  if (spec.family === 'rsa' && keyType !== 'rsa') {
    throw new JwtError(
      `Key type mismatch: ${alg} requires an RSA key, got ${keyType}`,
    );
  }
  if (spec.family === 'ec') {
    if (keyType !== 'ec') {
      throw new JwtError(
        `Key type mismatch: ${alg} requires an EC key, got ${keyType}`,
      );
    }
    const curve = resolved.key.asymmetricKeyDetails?.namedCurve;
    if (curve && curve !== spec.curve) {
      throw new JwtError(
        `Curve mismatch: ${alg} requires ${spec.curve}, got ${curve}`,
      );
    }
  }
}

const NONE_ALG = /^none$/i;

/** Validate a caller-supplied allowlist. `none` can never be allowlisted. */
export function validateAlgorithmAllowlist(
  algorithms: readonly string[],
): JwtAlgorithm[] {
  if (!Array.isArray(algorithms) || algorithms.length === 0) {
    throw new Error(
      '[axiomify/auth] An explicit, non-empty algorithm allowlist is required',
    );
  }
  const out: JwtAlgorithm[] = [];
  for (const alg of algorithms) {
    if (NONE_ALG.test(alg)) {
      throw new Error(
        '[axiomify/auth] The "none" algorithm is not permitted and cannot be allowlisted',
      );
    }
    if (!(alg in ALGORITHMS)) {
      throw new Error(`[axiomify/auth] Unsupported JWT algorithm "${alg}"`);
    }
    out.push(alg as JwtAlgorithm);
  }
  return out;
}

// ─── Signing ─────────────────────────────────────────────────────────────────

export interface SignJwtOptions {
  /** Signing algorithm. Required — there is no default. */
  algorithm: JwtAlgorithm;
  /** HS* secret (string/Buffer/secret KeyObject). Mutually exclusive with privateKey. */
  secret?: string | Buffer | KeyObject;
  /** RS* or ES* private key — PEM string or KeyObject. */
  privateKey?: string | KeyObject;
  /** Seconds until expiry — sets `exp` relative to now. */
  expiresIn?: number;
  /** Seconds until validity — sets `nbf` relative to now. */
  notBefore?: number;
  issuer?: string;
  audience?: string | string[];
  subject?: string;
  jwtid?: string;
  /** `kid` header parameter (JWKS consumers use it for key selection). */
  keyid?: string;
  /** Skip the automatic `iat` claim. */
  noTimestamp?: boolean;
  /** Extra header parameters (cannot override alg/typ). */
  header?: Record<string, unknown>;
}

function signaturePayload(
  alg: JwtAlgorithm,
  data: Buffer,
  resolved: ResolvedKey,
): Buffer {
  const spec = ALGORITHMS[alg];
  if (spec.family === 'hmac') {
    return createHmac(spec.hash, resolved.key).update(data).digest();
  }
  if (spec.family === 'ec') {
    // JOSE mandates the raw r||s concatenation, not ASN.1/DER.
    return cryptoSign(spec.hash, data, {
      key: resolved.key,
      dsaEncoding: 'ieee-p1363',
    });
  }
  return cryptoSign(spec.hash, data, resolved.key);
}

/** Sign a JWT with HS*, RS* or ES* using node:crypto. */
export function signJwt(payload: JwtClaims, options: SignJwtOptions): string {
  const [alg] = validateAlgorithmAllowlist([options.algorithm]);
  const keyInput = options.privateKey ?? options.secret;
  if (keyInput === undefined) {
    throw new Error(
      '[axiomify/auth] signJwt requires `secret` (HS*) or `privateKey` (RS*/ES*)',
    );
  }
  const resolved = resolveKey(keyInput, true);
  assertKeyCompatible(alg, resolved, true);

  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = { ...payload };
  if (!options.noTimestamp && claims.iat === undefined) claims.iat = now;
  if (options.expiresIn !== undefined) {
    claims.exp = now + Math.floor(options.expiresIn);
  }
  if (options.notBefore !== undefined) {
    claims.nbf = now + Math.floor(options.notBefore);
  }
  if (options.issuer !== undefined) claims.iss = options.issuer;
  if (options.audience !== undefined) claims.aud = options.audience;
  if (options.subject !== undefined) claims.sub = options.subject;
  if (options.jwtid !== undefined) claims.jti = options.jwtid;

  const header: JwtHeader = {
    ...options.header,
    alg,
    typ: 'JWT',
    ...(options.keyid ? { kid: options.keyid } : {}),
  };

  const signingInput =
    b64urlEncode(JSON.stringify(header)) +
    '.' +
    b64urlEncode(JSON.stringify(claims));
  const signature = signaturePayload(
    alg,
    Buffer.from(signingInput, 'utf8'),
    resolved,
  );
  return `${signingInput}.${b64urlEncode(signature)}`;
}

// ─── Verification ────────────────────────────────────────────────────────────

/** Async key resolver contract satisfied by JwksClient. */
export interface KeyResolver {
  getKey(kid: string | undefined, alg: string): Promise<KeyObject>;
}

export interface VerifyJwtOptions {
  /**
   * Per-call algorithm allowlist. REQUIRED. The token header's `alg` must be
   * an exact member. `none` is always rejected and cannot be allowlisted.
   */
  algorithms: readonly JwtAlgorithm[] | readonly string[];
  /** HS* secret (string/Buffer/secret KeyObject). */
  secret?: string | Buffer | KeyObject;
  /** RS* or ES* public key — PEM string or KeyObject. */
  publicKey?: string | KeyObject;
  /** JWKS-backed key resolver (asymmetric algorithms only). */
  keyResolver?: KeyResolver;
  /** Expected `iss` — exact string or one-of array. */
  issuer?: string | string[];
  /** Expected `aud` — validated with intersection semantics. */
  audience?: string | string[];
  /** Seconds of leeway for exp/nbf/iat comparisons. Default 0. */
  clockTolerance?: number;
  /** Maximum accepted age (seconds) based on `iat`. */
  maxTokenAge?: number;
  /** Override "now" for tests. */
  currentDate?: Date;
}

function verifySignature(
  alg: JwtAlgorithm,
  data: Buffer,
  signature: Buffer,
  resolved: ResolvedKey,
): boolean {
  const spec = ALGORITHMS[alg];
  if (spec.family === 'hmac') {
    const expected = createHmac(spec.hash, resolved.key)
      .update(data)
      .digest();
    return (
      expected.length === signature.length &&
      timingSafeEqual(expected, signature)
    );
  }
  try {
    if (spec.family === 'ec') {
      return cryptoVerify(
        spec.hash,
        data,
        { key: resolved.key, dsaEncoding: 'ieee-p1363' },
        signature,
      );
    }
    return cryptoVerify(spec.hash, data, resolved.key, signature);
  } catch {
    return false; // malformed signature material
  }
}

function toStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function validateClaims(
  payload: JwtClaims,
  options: VerifyJwtOptions,
): void {
  const nowMs = options.currentDate?.getTime() ?? Date.now();
  const now = nowMs / 1000;
  const tolerance = options.clockTolerance ?? 0;

  for (const claim of ['exp', 'nbf', 'iat'] as const) {
    if (payload[claim] !== undefined && typeof payload[claim] !== 'number') {
      throw new JwtError(`Invalid JWT: "${claim}" claim must be a number`);
    }
  }

  if (payload.nbf !== undefined && now < payload.nbf - tolerance) {
    throw new JwtNotBeforeError(
      'JWT not active yet (nbf)',
      new Date(payload.nbf * 1000),
    );
  }
  if (payload.exp !== undefined && now >= payload.exp + tolerance) {
    throw new JwtExpiredError('JWT expired', new Date(payload.exp * 1000));
  }
  if (options.maxTokenAge !== undefined) {
    if (payload.iat === undefined) {
      throw new JwtError('JWT missing "iat" claim required by maxTokenAge');
    }
    if (now - payload.iat > options.maxTokenAge + tolerance) {
      throw new JwtExpiredError(
        'JWT older than maxTokenAge',
        new Date((payload.iat + options.maxTokenAge) * 1000),
      );
    }
    if (payload.iat > now + tolerance) {
      throw new JwtError('JWT "iat" claim is in the future');
    }
  }

  if (options.issuer !== undefined) {
    const allowed = toStringArray(options.issuer);
    if (typeof payload.iss !== 'string' || !allowed.includes(payload.iss)) {
      throw new JwtError(
        `JWT "iss" claim mismatch: expected ${allowed.join(' | ')}`,
      );
    }
  }

  if (options.audience !== undefined) {
    const expected = toStringArray(options.audience);
    const actual =
      payload.aud === undefined ? [] : toStringArray(payload.aud as any);
    const match = actual.some(
      (aud) => typeof aud === 'string' && expected.includes(aud),
    );
    if (!match) {
      throw new JwtError(
        `JWT "aud" claim mismatch: expected ${expected.join(' | ')}`,
      );
    }
  }
}

/**
 * Verify a JWT and return its payload.
 *
 * Rejects `alg: none` unconditionally, enforces the caller's algorithm
 * allowlist against the token header, and blocks algorithm confusion by
 * binding key material type to algorithm family (see module docs).
 */
export async function verifyJwt(
  token: string,
  options: VerifyJwtOptions,
): Promise<JwtClaims> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new JwtError('Invalid JWT: token must be a non-empty string');
  }
  const allowlist = validateAlgorithmAllowlist(options.algorithms);

  const provided = [
    options.secret !== undefined,
    options.publicKey !== undefined,
    options.keyResolver !== undefined,
  ].filter(Boolean).length;
  if (provided !== 1) {
    throw new Error(
      '[axiomify/auth] verifyJwt requires exactly one of `secret`, `publicKey`, `keyResolver`',
    );
  }
  // A JWKS/public key context must never accept HS* — enforce at the
  // allowlist level too, before any token is even parsed.
  if (
    (options.publicKey !== undefined || options.keyResolver !== undefined) &&
    allowlist.some((a) => ALGORITHMS[a].family === 'hmac')
  ) {
    throw new Error(
      '[axiomify/auth] HS* algorithms cannot be allowlisted when verifying ' +
        'with a public key or JWKS (algorithm-confusion defence)',
    );
  }
  if (
    options.secret !== undefined &&
    allowlist.some((a) => ALGORITHMS[a].family !== 'hmac')
  ) {
    throw new Error(
      '[axiomify/auth] RS*/ES* algorithms cannot be allowlisted when ' +
        'verifying with a symmetric secret',
    );
  }

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new JwtError('Invalid JWT: expected three dot-separated segments');
  }
  const header = decodeJson(parts[0], 'header') as unknown as JwtHeader;

  if (typeof header.alg !== 'string' || NONE_ALG.test(header.alg)) {
    throw new JwtError('JWT rejected: unsigned ("none") tokens are forbidden');
  }
  if (!allowlist.includes(header.alg as JwtAlgorithm)) {
    throw new JwtError(
      `JWT rejected: header alg "${header.alg}" is not in the allowlist [${allowlist.join(', ')}]`,
    );
  }
  const alg = header.alg as JwtAlgorithm;

  let resolved: ResolvedKey;
  if (options.keyResolver) {
    const kid = typeof header.kid === 'string' ? header.kid : undefined;
    const key = await options.keyResolver.getKey(kid, alg);
    resolved = { kind: 'public', key };
  } else {
    resolved = resolveKey((options.publicKey ?? options.secret)!, false);
  }
  assertKeyCompatible(alg, resolved, false);

  const data = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const signature = b64urlDecode(parts[2], 'signature');
  if (!verifySignature(alg, data, signature, resolved)) {
    throw new JwtError('JWT signature verification failed');
  }

  const payload = decodeJson(parts[1], 'payload') as JwtClaims;
  validateClaims(payload, options);
  return payload;
}
