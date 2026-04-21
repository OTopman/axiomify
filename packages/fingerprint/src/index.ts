import type { Axiomify, AxiomifyRequest } from '@axiomify/core';
import { createHash } from 'crypto';

declare module '@axiomify/core' {
  interface RequestState {
    fingerprint?: string;
    fingerprintData?: FingerprintData;
  }
}

export interface FingerprintData {
  ip: string;
  userAgent: string;
  accept: string;
  acceptLanguage: string;
  acceptEncoding: string;
  connection?: string;
  doNotTrack?: string;
}

export interface FingerprintOptions {
  /** Custom hash algorithm. Default: 'sha256' */
  algorithm?: string;
  /** Secret salt to improve security. Default: none */
  salt?: string;
  /** List of headers to include in fingerprint. */
  headers?: string[];
}

/**
 * Advanced Production-Grade Client Fingerprinting.
 * Achieves high accuracy by combining multiple request attributes.
 */
export function useFingerprint(app: Axiomify, options: FingerprintOptions = {}): void {
  const {
    algorithm = 'sha256',
    salt = '',
    headers = [
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'dnt',
      'connection',
      'upgrade-insecure-requests',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform'
    ]
  } = options;

  app.addHook('onRequest', (req: AxiomifyRequest) => {
    const data: Record<string, string> = {
      ip: req.ip || '127.0.0.1'
    };

    // Collect headers for fingerprinting
    for (const header of headers) {
      const value = req.headers[header];
      if (value) {
        data[header] = Array.isArray(value) ? value.join(',') : value;
      }
    }

    // Generate a stable hash
    const fingerprintSource = JSON.stringify(data) + salt;
    const fingerprint = createHash(algorithm)
      .update(fingerprintSource)
      .digest('hex');

    // Attach to request state
    req.state.fingerprint = fingerprint;
    req.state.fingerprintData = data as any;
  });
}
