import { type ClientRequest } from './types';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  retryableStatusCodes: [408, 409, 429, 500, 502, 503, 504],
};

export async function withRetry<T>(
  requestFn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const mergedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let attempts = 0;

  while (true) {
    try {
      return await requestFn();
    } catch (err: any) {
      attempts++;
      if (attempts > mergedConfig.maxRetries) {
        throw err;
      }

      const status = err.status || err.response?.status;
      if (status && !mergedConfig.retryableStatusCodes.includes(status)) {
        throw err; // Not retryable
      }

      // Exponential backoff with full jitter
      const delay = Math.min(
        mergedConfig.maxDelayMs,
        mergedConfig.baseDelayMs * Math.pow(2, attempts - 1)
      );
      const jitter = Math.random() * delay;

      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }
}
