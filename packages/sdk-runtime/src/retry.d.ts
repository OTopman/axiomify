export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryableStatusCodes: number[];
}
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;
export declare function withRetry<T>(requestFn: () => Promise<T>, config?: Partial<RetryConfig>): Promise<T>;
//# sourceMappingURL=retry.d.ts.map