export interface CircuitBreakerConfig {
  failureThreshold: number; // number of failures before tripping
  cooldownPeriodMs: number; // time to wait before trying again in HALF_OPEN
  halfOpenMaxProbeRequests: number; // probe request count in HALF_OPEN
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures = 0;
  private lastStateChange: number = Date.now();
  private halfOpenSuccessfulRequests = 0;

  constructor(
    private config: CircuitBreakerConfig = {
      failureThreshold: 5,
      cooldownPeriodMs: 10000,
      halfOpenMaxProbeRequests: 3,
    },
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === 'OPEN') {
      throw new CircuitBreakerError(
        'Circuit breaker is OPEN. Requests blocked.',
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private checkState(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed > this.config.cooldownPeriodMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccessfulRequests++;
      if (
        this.halfOpenSuccessfulRequests >= this.config.halfOpenMaxProbeRequests
      ) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    if (
      this.state === 'HALF_OPEN' ||
      this.failures >= this.config.failureThreshold
    ) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'): void {
    this.state = newState;
    this.lastStateChange = Date.now();
    if (newState === 'CLOSED') {
      this.failures = 0;
    } else if (newState === 'HALF_OPEN') {
      this.halfOpenSuccessfulRequests = 0;
    }
  }

  getState() {
    return this.state;
  }
}
