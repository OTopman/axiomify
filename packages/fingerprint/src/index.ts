import type { Axiomify, AxiomifyRequest } from '@axiomify/core';
import { createHash } from 'crypto';

declare module '@axiomify/core' {
  interface RequestState {
    fingerprint?: string;
    fingerprintData?: FingerprintData;
    fingerprintConfidence?: number;
  }
}

export interface FingerprintData {
  version: string;
  ip: string;
  userAgent?: string;
  accept?: string;
  acceptLanguage?: string;
  acceptEncoding?: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
  secChUaFullVersionList?: string;
  timezone?: string;
  dnt?: string;
  connection?: string;
  platform?: string;
  host?: string;
}

export interface FingerprintOptions {
  algorithm?: string;
  salt?: string;
  includeIp?: boolean;
  includePath?: boolean;
  additionalHeaders?: string[];
  trustProxyHeaders?: boolean;
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
  'x-timezone': 'timezone',
  dnt: 'dnt',
  connection: 'connection',
  'sec-ch-ua-platform-version': 'platform',
  host: 'host',
};

const SIGNAL_WEIGHTS: Partial<Record<keyof FingerprintData, number>> = {
  userAgent: 16,
  acceptLanguage: 12,
  acceptEncoding: 10,
  secChUa: 12,
  secChUaPlatform: 10,
  secChUaFullVersionList: 10,
  timezone: 10,
  host: 8,
  ip: 8,
};

function normalizeHeader(value: string | string[] | undefined): string | undefined {
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

  return Math.max(0, Math.min(98, score));
}

function getTrustedIp(req: AxiomifyRequest, trustProxyHeaders: boolean): string {
  if (!trustProxyHeaders) return normalizeIp(req.ip || '127.0.0.1');

  const forwardedFor = normalizeHeader(req.headers['x-forwarded-for']);
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    return normalizeIp(first || req.ip || '127.0.0.1');
  }

  const realIp = normalizeHeader(req.headers['x-real-ip']);
  return normalizeIp(realIp || req.ip || '127.0.0.1');
}

function stableSortObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = input[key];
      return acc;
    }, {});
}

export function useFingerprint(app: Axiomify, options: FingerprintOptions = {}): void {
  const {
    algorithm = 'sha256',
    salt = '',
    includeIp = true,
    includePath = false,
    additionalHeaders = [],
    trustProxyHeaders = false,
  } = options;

  app.addHook('onRequest', (req: AxiomifyRequest) => {
    const data: FingerprintData = {
      version: 'fp-v2',
      ip: includeIp ? getTrustedIp(req, trustProxyHeaders) : 'ip-omitted',
    };

    for (const [header, key] of Object.entries(BASE_HEADER_MAP)) {
      const normalized = normalizeHeader(req.headers[header]);
      if (normalized) {
        (data as any)[key] = normalized;
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
