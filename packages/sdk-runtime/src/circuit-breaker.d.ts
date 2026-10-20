export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownPeriodMs: number;
  halfOpenMaxProbeRequests: number;
}
export declare class CircuitBreakerError extends Error {
  constructor(message: string);
}
export declare class CircuitBreaker {
  private config;
  private state;
  private failures;
  private lastStateChange;
  private halfOpenSuccessfulRequests;
  constructor(config?: CircuitBreakerConfig);
  run<T>(fn: () => Promise<T>): Promise<T>;
  private checkState;
  private onSuccess;
  private onFailure;
  private transitionTo;
  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}
//# sourceMappingURL=circuit-breaker.d.ts.map
