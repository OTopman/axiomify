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
  ip: string;
  userAgent?: string;
  accept?: string;
  acceptLanguage?: string;
  acceptEncoding?: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
  timezone?: string;
  dnt?: string;
  connection?: string;
}

export interface FingerprintOptions {
  algorithm?: string;
  salt?: string;
  includeIp?: boolean;
  includePath?: boolean;
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
  'x-timezone': 'timezone',
  dnt: 'dnt',
  connection: 'connection',
};

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value.join(',') : value;
}

function computeConfidence(data: FingerprintData): number {
  const stableKeys: (keyof FingerprintData)[] = [
    'userAgent',
    'acceptLanguage',
    'acceptEncoding',
    'secChUa',
    'secChUaPlatform',
    'timezone',
  ];

  const present = stableKeys.filter((key) => !!data[key]).length;
  const raw = 50 + present * 8;
  return Math.min(98, raw);
}

export function useFingerprint(app: Axiomify, options: FingerprintOptions = {}): void {
  const {
    algorithm = 'sha256',
    salt = '',
    includeIp = true,
    includePath = false,
    additionalHeaders = [],
  } = options;

  app.addHook('onRequest', (req: AxiomifyRequest) => {
    const data: FingerprintData = {
      ip: includeIp ? req.ip || '127.0.0.1' : 'ip-omitted',
    };

    for (const [header, key] of Object.entries(BASE_HEADER_MAP)) {
      const normalized = normalizeHeader(req.headers[header]);
      if (normalized) (data as any)[key] = normalized;
    }

    for (const header of additionalHeaders) {
      const normalized = normalizeHeader(req.headers[header.toLowerCase()]);
      if (normalized) {
        (data as any)[header.toLowerCase()] = normalized;
      }
    }

    const payload = {
      ...data,
      ...(includePath ? { path: req.path } : {}),
      salt,
    };

    const fingerprint = createHash(algorithm).update(JSON.stringify(payload)).digest('hex');

    req.state.fingerprint = fingerprint;
    req.state.fingerprintData = data;
    req.state.fingerprintConfidence = computeConfidence(data);
  });
}
