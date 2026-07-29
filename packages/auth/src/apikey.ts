/**
 * API-key authentication for Axiomify.
 *
 * Key format: `ax_<id>_<secret>` — the `id` locates the key record, the
 * `secret` is what actually authenticates. Only `sha256(secret)` is ever
 * stored or compared; the comparison itself is constant-time
 * (`crypto.timingSafeEqual` on fixed-length digests), and a dummy compare is
 * performed even when the id is unknown so key discovery cannot be timed.
 */
import {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteMiddleware,
} from '@axiomify/core';
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export interface ApiKeyRecord {
  /** Hex-encoded SHA-256 hash or PBKDF2 string (`pbkdf2:sha256:iter:salt:hash`) of the key's secret part. */
  hashedKey: string;
  /** Scopes granted to this key. */
  scopes?: string[];
  /** Arbitrary metadata surfaced on `req.state.apiKey.meta`. */
  meta?: Record<string, unknown>;
}

/**
 * Async key resolver — return the record for a key id, or `null`/`undefined`
 * when the id is unknown. Errors thrown here surface as 503 (infrastructure),
 * never as 401.
 */
export type ApiKeyLookup = (
  id: string,
) => Promise<ApiKeyRecord | null | undefined>;

export interface ApiKeyPluginOptions {
  /**
   * Static key map: id → record with `hashedKey` (sha256 hex or PBKDF2 digest of the secret).
   * A plain-string value is treated as a PLAINTEXT secret and hashed at
   * startup — allowed for development, but a warning is logged because the
   * secret then lives in config/source.
   */
  keys?: Record<string, ApiKeyRecord | string>;
  /** Dynamic lookup (e.g. database). Exactly one of `keys`/`lookup` is required. */
  lookup?: ApiKeyLookup;
  /** Request header carrying the key. Default `x-api-key`. */
  header?: string;
  /** Default scopes required by every `requireApiKey()` without arguments. */
  scopes?: string[];
}

export interface ApiKeyAuthInfo {
  id: string;
  scopes: string[];
  meta?: Record<string, unknown>;
}

export interface ApiKeyPlugin {
  /**
   * Route plugin that authenticates the API key and (optionally) requires
   * scopes. Missing/invalid key → 401; valid key lacking scopes → 403.
   * On success `req.state.user` and `req.state.apiKey` are populated.
   */
  requireApiKey(scopes?: string[]): RouteMiddleware;
}

const API_KEY_PREFIX = 'ax';
const HASH_HEX = /^[0-9a-f]{64}$/i;
const PBKDF2_PREFIX = 'pbkdf2:sha256:';
const DEFAULT_PBKDF2_ITERATIONS = 100000;
const PBKDF2_FORMAT = /^pbkdf2:sha256:(\d+):([0-9a-f]{32}):([0-9a-f]{64})$/i;
const MAX_KEY_LENGTH = 512;

/** SHA-256 hash of an API-key secret, hex-encoded — what you store. */
export function hashApiKeySecret(secret: string): string {
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const derived = pbkdf2Sync(
    secret,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Hash an API key secret with PBKDF2-HMAC-SHA256 (recommended for high computational effort).
 * Returns a `pbkdf2:sha256:iterations:salt:hash` formatted string.
 */
export function hashApiKeySecretPbkdf2(
  secret: string,
  options?: { iterations?: number; salt?: string },
): string {
  const iterations = options?.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const saltHex =
    options?.salt ??
    createHash('sha256').update(`axiomify-salt:${secret}`).digest('hex').slice(0, 32);
  const salt = Buffer.from(saltHex, 'hex');
  const derived = pbkdf2Sync(secret, salt, iterations, 32, 'sha256').toString('hex');
  return `${PBKDF2_PREFIX}${iterations}:${saltHex}:${derived}`;
}

/**
 * Generate a new API key. Returns the full key (give it to the caller ONCE),
 * plus the id and hashed secret to persist. The plaintext secret is not
 * returned separately — it is only recoverable from `apiKey`.
 */
export function generateApiKey(id?: string): {
  apiKey: string;
  id: string;
  hashedKey: string;
} {
  const keyId = id ?? randomBytes(8).toString('hex');
  if (keyId.includes('_')) {
    throw new Error('[axiomify/auth] API key ids must not contain "_"');
  }
  const secret = randomBytes(24).toString('base64url');
  return {
    apiKey: `${API_KEY_PREFIX}_${keyId}_${secret}`,
    id: keyId,
    hashedKey: hashApiKeySecret(secret),
  };
}

/** Parse `ax_<id>_<secret>`. Returns null for anything malformed. */
export function parseApiKey(
  raw: string,
): { id: string; secret: string } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length > MAX_KEY_LENGTH) return null;
  if (!raw.startsWith(`${API_KEY_PREFIX}_`)) return null;
  const rest = raw.slice(API_KEY_PREFIX.length + 1);
  const sep = rest.indexOf('_');
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { id: rest.slice(0, sep), secret: rest.slice(sep + 1) };
}

// Dummy digest compared against when the key id is unknown, so unknown ids
// cost the same as wrong secrets (no key-enumeration timing oracle).
const DUMMY_DIGEST = createHash('sha256').update('axiomify-dummy').digest();
const DUMMY_PBKDF2_SALT = Buffer.alloc(16, 0);
const DUMMY_PBKDF2_HASH = pbkdf2Sync('axiomify-dummy', DUMMY_PBKDF2_SALT, 1, 32, 'sha256');

function secretMatches(secret: string, hashedKey: string): boolean {
  const provided = createHash('sha256').update(secret, 'utf8').digest();
  let stored: Buffer;
  if (HASH_HEX.test(hashedKey)) {
    stored = Buffer.from(hashedKey, 'hex');
  } else {
    // Also run dummy PBKDF2 so non-existent IDs with PBKDF2 or legacy format have balanced cost
    pbkdf2Sync(secret, DUMMY_PBKDF2_SALT, 1, 32, 'sha256');
    stored = DUMMY_DIGEST; // misconfigured record can never match
  }
  return timingSafeEqual(provided, stored) && stored !== DUMMY_DIGEST;
}

function normalizeStaticKeys(
  keys: Record<string, ApiKeyRecord | string>,
): Map<string, ApiKeyRecord> {
  const out = new Map<string, ApiKeyRecord>();
  let plaintextCount = 0;
  for (const [id, value] of Object.entries(keys)) {
    if (id.includes('_')) {
      throw new Error(
        `[axiomify/auth] API key id "${id}" must not contain "_" (reserved as the key-format separator)`,
      );
    }
    if (typeof value === 'string') {
      plaintextCount++;
      out.set(id, { hashedKey: hashApiKeySecret(value) });
      continue;
    }
    if (!value || typeof value.hashedKey !== 'string') {
      throw new Error(
        `[axiomify/auth] API key "${id}" record must include a "hashedKey"`,
      );
    }
    if (!HASH_HEX.test(value.hashedKey) && !PBKDF2_FORMAT.test(value.hashedKey)) {
      throw new Error(
        `[axiomify/auth] API key "${id}" hashedKey must be a 64-char hex SHA-256 digest or pbkdf2:sha256:... digest. ` +
          'Generate one with hashApiKeySecret(secret).',
      );
    }
    out.set(id, value);
  }
  if (plaintextCount > 0) {
    console.warn(
      `[axiomify/auth] ${plaintextCount} API key(s) were provided as PLAINTEXT secrets. ` +
        'Store sha256 hashes instead ({ hashedKey: hashApiKeySecret(secret) }) so a config ' +
        'leak does not leak usable credentials.',
    );
  }
  return out;
}

function getHeaderValue(
  req: AxiomifyRequest,
  name: string,
): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Create an API-key authentication plugin.
 *
 * ```ts
 * const apiKeys = createApiKeyPlugin({
 *   lookup: async (id) => db.apiKeys.findById(id), // { hashedKey, scopes, meta } | null
 * });
 * app.route({ path: '/admin', plugins: [apiKeys.requireApiKey(['admin'])], ... });
 * ```
 */
export function createApiKeyPlugin(options: ApiKeyPluginOptions): ApiKeyPlugin {
  if (!options || (!options.keys && !options.lookup)) {
    throw new Error(
      '[axiomify/auth] createApiKeyPlugin requires `keys` or `lookup`',
    );
  }
  if (options.keys && options.lookup) {
    throw new Error(
      '[axiomify/auth] createApiKeyPlugin accepts `keys` OR `lookup`, not both',
    );
  }
  const staticKeys = options.keys ? normalizeStaticKeys(options.keys) : null;
  const headerName = (options.header ?? 'x-api-key').toLowerCase();
  const defaultScopes = options.scopes ?? [];

  async function resolveRecord(id: string): Promise<ApiKeyRecord | null> {
    if (staticKeys) return staticKeys.get(id) ?? null;
    try {
      return (await options.lookup!(id)) ?? null;
    } catch {
      throw Object.assign(new Error('API key lookup failed'), {
        statusCode: 503,
      });
    }
  }

  function requireApiKey(scopes?: string[]): RouteMiddleware {
    const required = scopes ?? defaultScopes;
    return async (req: AxiomifyRequest, res: AxiomifyResponse) => {
      const raw = getHeaderValue(req, headerName);
      if (!raw) {
        return res.status(401).send(null, 'Unauthorized: Missing API key');
      }
      const parsed = parseApiKey(raw.trim());
      if (!parsed) {
        return res.status(401).send(null, 'Unauthorized: Malformed API key');
      }

      const record = await resolveRecord(parsed.id);
      // Always run the hash compare — unknown ids must cost the same as
      // wrong secrets.
      const valid =
        secretMatches(parsed.secret, record?.hashedKey ?? '') &&
        record !== null;
      if (!valid) {
        return res.status(401).send(null, 'Unauthorized: Invalid API key');
      }

      const granted = record!.scopes ?? [];
      const missing = required.filter((s) => !granted.includes(s));
      if (missing.length > 0) {
        return res
          .status(403)
          .send(
            null,
            `Forbidden: API key missing required scope(s): ${missing.join(', ')}`,
          );
      }

      const info: ApiKeyAuthInfo = Object.freeze({
        id: parsed.id,
        scopes: Object.freeze([...granted]) as string[],
        ...(record!.meta !== undefined ? { meta: record!.meta } : {}),
      });
      const user = { id: parsed.id, scopes: info.scopes, authType: 'api-key' };
      if (typeof req.state.set === 'function') {
        req.state.set('user', user); // state freezes 'user' (write-once)
        req.state.set('apiKey', info);
      } else {
        (req.state as any).user = Object.freeze(user);
        (req.state as any).apiKey = info;
      }
    };
  }

  return { requireApiKey };
}

/** Read the authenticated API key info set by `requireApiKey`. */
export function getApiKey(req: AxiomifyRequest): ApiKeyAuthInfo | undefined {
  return req.state.apiKey as ApiKeyAuthInfo | undefined;
}
