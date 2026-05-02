import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import { createHash, randomUUID } from 'node:crypto';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface FingerprintData {
  version: string;
  ip: string;
  serverId?: string;
  ja3?: string;
  userAgent?: string;
  accept?: string;
  acceptLanguage?: string;
  acceptEncoding?: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
  secChUaFullVersionList?: string;
  secChUaModel?: string;
  secChUaArch?: string;
  secChUaBitness?: string;
  timezone?: string;
  dnt?: string;
  connection?: string;
  platform?: string;
  host?: string;
  deviceId?: string;
}

export interface FingerprintOptions {
  /**
   * The cryptographic hash algorithm used to generate the fingerprint.
   * @default 'sha256'
   * @example 'sha256', 'sha512'
   */
  algorithm?: 'sha256' | 'sha512' | string;

  /**
   * A secret string appended to the payload before hashing to prevent
   * reverse-engineering of the fingerprint generation.
   * @default ''
   */
  salt?: string;

  /**
   * Includes the client's IP address in the entropy payload.
   * Set to `false` for strict privacy compliance.
   * @default true
   */
  includeIp?: boolean;

  /**
   * Includes the requested URL path in the fingerprint hash.
   * Useful for creating path-specific rate limit identifiers.
   * @default false
   */
  includePath?: boolean;

  /**
   * When `true`, extracts the IP from `X-Forwarded-For`/`X-Real-IP` and automatically
   * sweeps for infrastructure-injected TLS hashes (e.g., `X-JA3-Fingerprint`).
   * @default false
   */
  trustProxyHeaders?: boolean;

  /**
   * Enables native device deduplication by locking a UUID in an `HttpOnly` cookie.
   * Accepts a boolean or a custom configuration object.
   * @default true
   */
  statefulCookie?: boolean | { name?: string; maxAge?: number };

  /**
   * An array of custom HTTP headers to append as extra entropy sources.
   * @example ['x-tenant-id', 'x-app-version']
   * @default []
   */
  additionalHeaders?: string[];
}

const BASE_HEADER_MAP: Record<string, keyof FingerprintData> = {
  'user-agent': 'userAgent',
  accept: 'accept',
  'accept-language': 'acceptLanguage',
  'accept-encoding': 'acceptEncoding',
  'sec-ch-ua': 'secChUa',
  'sec-ch-ua-mobile': 'secChUaMobile',
  'sec-ch-ua-platform': 'secChUaPlatform',
  'sec-ch-ua-full-version-list': 'secChUaFullVersionList',
  'sec-ch-ua-model': 'secChUaModel',
  'sec-ch-ua-arch': 'secChUaArch',
  'sec-ch-ua-bitness': 'secChUaBitness',
  'x-timezone': 'timezone',
  dnt: 'dnt',
  connection: 'connection',
  host: 'host',
  // Auto-Capture Infrastructure Signatures
  'x-ja3-fingerprint': 'ja3',
  'cf-bot-management-ja3-hash': 'ja3',
  'x-device-id': 'deviceId',
};

const SIGNAL_WEIGHTS: Partial<Record<keyof FingerprintData, number>> = {
  serverId: 40,
  ja3: 20,
  userAgent: 12,
  acceptLanguage: 8,
  secChUaFullVersionList: 8,
  secChUaModel: 6,
  timezone: 6,
  ip: 8,
};

function normalizeHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (!value) return undefined;
  const merged = Array.isArray(value) ? value.join(',') : value;
  return merged.trim().toLowerCase();
}

function normalizeIp(ip: string): string {
  if (!ip) return '0.0.0.0';
  if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '');
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function computeConfidence(data: FingerprintData): number {
  const base = 32;
  const score = Object.entries(SIGNAL_WEIGHTS).reduce((acc, [key, weight]) => {
    if (data[key as keyof FingerprintData]) return acc + (weight ?? 0);
    return acc;
  }, base);

  return Math.max(0, Math.min(98, score)); // Caps at 98%
}

function getTrustedIp(
  req: AxiomifyRequest,
  trustProxyHeaders: boolean,
): string {
  if (!trustProxyHeaders) return normalizeIp(req.ip || '127.0.0.1');

  const forwardedFor = normalizeHeader(req.headers['x-forwarded-for']);
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    return normalizeIp(first || req.ip || '127.0.0.1');
  }

  const realIp = normalizeHeader(req.headers['x-real-ip']);
  return normalizeIp(realIp || req.ip || '127.0.0.1');
}

function stableSortObject(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = input[key];
      return acc;
    }, {});
}

export function useFingerprint(
  app: Axiomify,
  options: FingerprintOptions = {},
): void {
  const {
    algorithm = 'sha256',
    salt = '',
    includeIp = true,
    includePath = false,
    additionalHeaders = [],
    trustProxyHeaders = false,
    statefulCookie = true,
  } = options;

  app.addHook('onRequest', (req: AxiomifyRequest, res: AxiomifyResponse) => {
    let serverId: string | undefined;

    if (statefulCookie) {
      const cookieName =
        typeof statefulCookie === 'object' && statefulCookie.name
          ? statefulCookie.name
          : 'ax_fp_id';
      const maxAge =
        typeof statefulCookie === 'object' && statefulCookie.maxAge
          ? statefulCookie.maxAge
          : 31536000;

      const cookies = (req.headers.cookie as string) || '';
      // Escape the cookie name before building the RegExp to prevent ReDoS
      // if the name ever contains regex metacharacters.
      const match = cookies.match(
        new RegExp(`${escapeRegExp(cookieName)}=([^;]+)`),
      );
      serverId = match ? match[1] : undefined;

      if (!serverId && res && typeof res.header === 'function') {
        serverId = randomUUID();
        res.header(
          'Set-Cookie',
          `${cookieName}=${serverId}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
        );
      }
    }

    const data: FingerprintData = {
      version: 'fp-v4',
      ip: includeIp ? getTrustedIp(req, trustProxyHeaders) : 'ip-omitted',
      ...(serverId && { serverId }),
    };

    for (const [header, key] of Object.entries(BASE_HEADER_MAP)) {
      if (!trustProxyHeaders && (key === 'ja3' || key === 'deviceId')) continue;
      const normalized = normalizeHeader(req.headers[header]);
      if (normalized && !data[key]) {
        data[key] = normalized;
      }
    }

    for (const header of additionalHeaders) {
      const normalized = normalizeHeader(req.headers[header.toLowerCase()]);
      if (normalized) {
        (data as any)[header.toLowerCase()] = normalized;
      }
    }

    const payload = stableSortObject({
      ...data,
      ...(includePath ? { path: req.path } : {}),
      salt,
    });

    const fingerprint = createHash(algorithm)
      .update(JSON.stringify(payload))
      .digest('hex');

    req.state.fingerprint = fingerprint;
    req.state.fingerprintData = data;
    req.state.fingerprintConfidence = computeConfidence(data);
  });
}
