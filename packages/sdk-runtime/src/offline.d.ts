export interface QueuedRequest {
  id: string;
  path: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
  timestamp: number;
}
export declare class OfflineQueue {
  private queue;
  constructor();
  enqueue(req: Omit<QueuedRequest, 'id' | 'timestamp'>): void;
  getQueue(): QueuedRequest[];
  flush(processor?: (req: QueuedRequest) => Promise<void>): Promise<void>;
  clear(): void;
}
//# sourceMappingURL=offline.d.ts.map
