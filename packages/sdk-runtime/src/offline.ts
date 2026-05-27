export interface QueuedRequest {
  id: string;
  path: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
  timestamp: number;
}

export class OfflineQueue {
  private queue: QueuedRequest[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'addEventListener' in window) {
      window.addEventListener('online', () => this.flush());
    }
  }

  enqueue(req: Omit<QueuedRequest, 'id' | 'timestamp'>): void {
    const queued: QueuedRequest = {
      ...req,
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now()
    };
    this.queue.push(queued);
  }

  getQueue(): QueuedRequest[] {
    return [...this.queue];
  }

  async flush(processor?: (req: QueuedRequest) => Promise<void>): Promise<void> {
    if (this.queue.length === 0) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return; // Still offline

    const toProcess = [...this.queue];
    this.queue = [];

    for (const req of toProcess) {
      try {
        if (processor) {
          await processor(req);
        }
      } catch (err) {
        // Re-enqueue if failed
        this.queue.push(req);
      }
    }
  }

  clear(): void {
    this.queue = [];
  }
}
