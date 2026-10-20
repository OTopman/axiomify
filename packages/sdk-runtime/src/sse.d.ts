export interface SseOptions {
  headers?: Record<string, string>;
  maxRetries?: number;
  baseDelayMs?: number;
  onOpen?: () => void;
  onMessage?: (event: string, data: string) => void;
  onError?: (err: any) => void;
}
export declare class SseClient {
  private url;
  private options;
  private abortController;
  private retries;
  private active;
  constructor(url: string, options?: SseOptions);
  connect(): void;
  disconnect(): void;
  private startStream;
}
//# sourceMappingURL=sse.d.ts.map
