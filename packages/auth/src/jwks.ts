/**
 * JWKS (RFC 7517) key resolver for asymmetric JWT verification.
 *
 * - Keys are fetched with the global `fetch` and cached by `kid` for
 *   `cacheTtlMs` (default 10 minutes).
 * - An unknown `kid` triggers a refetch (key rotation), but never more often
 *   than `cooldownMs` (default 30 seconds, hard-floored at 30s) so a flood of
 *   forged-kid tokens cannot hammer the JWKS endpoint.
 * - At most `maxKeys` keys are retained (default 32) to bound memory.
 * - Only RSA and EC signature keys are accepted — symmetric (`oct`) JWKs are
 *   discarded so a hostile JWKS document can never enable HS* verification.
 */
import { createPublicKey, KeyObject } from 'node:crypto';
import type { KeyResolver } from './jwt';
import { JwtError } from './jwt';

export interface JwksClientOptions {
  /** JWKS document URL, e.g. `https://issuer/.well-known/jwks.json`. */
  url: string;
  /** Cache lifetime for the fetched key set. Default 600 000 ms (10 min). */
  cacheTtlMs?: number;
  /**
   * Minimum interval between refetches triggered by an unknown `kid`.
   * Default and minimum: 30 000 ms.
   */
  cooldownMs?: number;
  /** Maximum number of keys retained from the JWKS document. Default 32. */
  maxKeys?: number;
  /** Abort the JWKS fetch after this many ms. Default 10 000. */
  requestTimeoutMs?: number;
}

interface JsonWebKey {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  crv?: string;
  key_ops?: string[];
  [param: string]: unknown;
}

interface CachedKey {
  key: KeyObject;
  kty: string;
  crv?: string;
  alg?: string;
}

const MIN_COOLDOWN_MS = 30_000;

const ALG_REQUIREMENTS: Record<string, { kty: string; crv?: string }> = {
  RS256: { kty: 'RSA' },
  RS384: { kty: 'RSA' },
  RS512: { kty: 'RSA' },
  ES256: { kty: 'EC', crv: 'P-256' },
  ES384: { kty: 'EC', crv: 'P-384' },
};

/** Error class for JWKS transport/parse failures. Maps to 503, not 401. */
export class JwksFetchError extends Error {
  readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'JwksFetchError';
  }
}

export class JwksClient implements KeyResolver {
  private readonly url: string;
  private readonly cacheTtlMs: number;
  private readonly cooldownMs: number;
  private readonly maxKeys: number;
  private readonly requestTimeoutMs: number;

  private keys = new Map<string, CachedKey>();
  private fetchedAt = 0;
  private lastFetchAttempt = 0;
  private inflight: Promise<void> | null = null;

  constructor(options: JwksClientOptions) {
    if (!options?.url) {
      throw new Error('[axiomify/auth] JwksClient requires a `url`');
    }
    this.url = options.url;
    this.cacheTtlMs = options.cacheTtlMs ?? 600_000;
    this.cooldownMs = Math.max(
      options.cooldownMs ?? MIN_COOLDOWN_MS,
      MIN_COOLDOWN_MS,
    );
    this.maxKeys = options.maxKeys ?? 32;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  /**
   * Resolve a verification key for the given `kid` and algorithm.
   *
   * When the token has no `kid`, the key set must contain exactly one
   * compatible key — otherwise selection would be ambiguous and unsafe.
   */
  async getKey(kid: string | undefined, alg: string): Promise<KeyObject> {
    const requirement = ALG_REQUIREMENTS[alg];
    if (!requirement) {
      // HS*/none can never be served from a JWKS.
      throw new JwtError(
        `JWKS cannot provide keys for algorithm "${alg}" — only RS*/ES* are supported`,
      );
    }

    const now = Date.now();
    const cacheFresh = this.fetchedAt !== 0 && now - this.fetchedAt < this.cacheTtlMs;

    if (!cacheFresh) {
      await this.refresh();
    }

    let found = this.lookup(kid, requirement);
    if (!found && cacheFresh) {
      // Possible key rotation: refetch, but respect the cooldown so forged
      // kids cannot turn us into a JWKS-endpoint DoS cannon.
      if (Date.now() - this.lastFetchAttempt >= this.cooldownMs) {
        await this.refresh();
        found = this.lookup(kid, requirement);
      }
    }

    if (!found) {
      throw new JwtError(
        kid
          ? `JWT verification key "${kid}" not found in JWKS`
          : 'JWT has no "kid" and the JWKS has no single unambiguous compatible key',
      );
    }
    return found.key;
  }

  /** Drop all cached keys — next getKey() refetches. */
  clearCache(): void {
    this.keys.clear();
    this.fetchedAt = 0;
    this.lastFetchAttempt = 0;
  }

  private lookup(
    kid: string | undefined,
    requirement: { kty: string; crv?: string },
  ): CachedKey | undefined {
    const compatible = (k: CachedKey) =>
      k.kty === requirement.kty &&
      (requirement.crv === undefined || k.crv === requirement.crv);

    if (kid !== undefined) {
      const hit = this.keys.get(kid);
      return hit && compatible(hit) ? hit : undefined;
    }
    const matches = [...this.keys.values()].filter(compatible);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private refresh(): Promise<void> {
    // Deduplicate concurrent refreshes into a single network round-trip.
    if (!this.inflight) {
      this.inflight = this.fetchKeys().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetchKeys(): Promise<void> {
    this.lastFetchAttempt = Date.now();
    let response: Response;
    try {
      response = await fetch(this.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      throw new JwksFetchError(
        `JWKS fetch failed for ${this.url}: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!response.ok) {
      throw new JwksFetchError(
        `JWKS endpoint ${this.url} responded ${response.status}`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new JwksFetchError(`JWKS endpoint ${this.url} returned invalid JSON`);
    }
    const jwks = body as { keys?: JsonWebKey[] };
    if (!Array.isArray(jwks?.keys)) {
      throw new JwksFetchError(
        `JWKS document from ${this.url} has no "keys" array`,
      );
    }

    const next = new Map<string, CachedKey>();
    for (const jwk of jwks.keys) {
      if (next.size >= this.maxKeys) break;
      // Signature keys only; explicitly discard symmetric material so a
      // compromised JWKS can never smuggle in an HS* secret.
      if (jwk?.kty !== 'RSA' && jwk?.kty !== 'EC') continue;
      if (jwk.use !== undefined && jwk.use !== 'sig') continue;
      if (
        Array.isArray(jwk.key_ops) &&
        !jwk.key_ops.includes('verify')
      ) {
        continue;
      }
      if (typeof jwk.kid !== 'string' || jwk.kid.length === 0) continue;
      try {
        const key = createPublicKey({ key: jwk as any, format: 'jwk' });
        if (key.type !== 'public') continue;
        next.set(jwk.kid, {
          key,
          kty: jwk.kty,
          crv: typeof jwk.crv === 'string' ? jwk.crv : undefined,
          alg: typeof jwk.alg === 'string' ? jwk.alg : undefined,
        });
      } catch {
        // Skip malformed JWK entries rather than failing the whole set.
      }
    }

    this.keys = next;
    this.fetchedAt = Date.now();
  }
}
