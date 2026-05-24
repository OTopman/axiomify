/**
 * Shared types for the SDK runtime.
 */
import type { AuthProvider } from './auth';
import type { RetryConfig } from './retry';

export interface ClientConfig {
  /** The base URL of the API. */
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetch?: typeof fetch;
  authProvider?: AuthProvider;
  retryConfig?: Partial<RetryConfig>;
}

export interface ClientRequest {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ClientResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
  request: ClientRequest;
}

export class SdkError extends Error {
  constructor(
    public message: string,
    public status?: number,
    public response?: ClientResponse
  ) {
    super(message);
    this.name = 'SdkError';
  }
}

export * from './auth';
export * from './interceptors';
export * from './retry';
