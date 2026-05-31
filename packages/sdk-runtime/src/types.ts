/**
 * Shared types for the SDK runtime.
 */
import type { AuthProvider } from './auth';
import type { RetryConfig } from './retry';
import type { CircuitBreakerConfig } from './circuit-breaker';

export interface ClientConfig {
  /** The base URL of the API. */
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetch?: typeof fetch;
  authProvider?: AuthProvider;
  retryConfig?: Partial<RetryConfig>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  enableCache?: boolean;
  cacheTtlMs?: number;
  telemetry?: {
    onBeforeRequest?: (req: ClientRequest) => void | Promise<void>;
    onAfterResponse?: (res: ClientResponse) => void | Promise<void>;
    onError?: (err: any) => void | Promise<void>;
  };
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
    public response?: ClientResponse,
  ) {
    super(message);
    this.name = 'SdkError';
  }
}

export * from './auth';
export * from './interceptors';
export * from './retry';
export * from './circuit-breaker';
export * from './cache';
export * from './sse';
export * from './websocket';
export * from './pagination';
export * from './serializer';
export * from './offline';
export * from './environment';
