export interface SseOptions {
  headers?: Record<string, string>;
  maxRetries?: number;
  baseDelayMs?: number;
  onOpen?: () => void;
  onMessage?: (event: string, data: string) => void;
  onError?: (err: any) => void;
}

export class SseClient {
  private abortController: AbortController | null = null;
  private retries = 0;
  private active = false;

  constructor(private url: string, private options: SseOptions = {}) {}

  connect(): void {
    if (this.active) return;
    this.active = true;
    this.retries = 0;
    this.startStream();
  }

  disconnect(): void {
    this.active = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async startStream(): Promise<void> {
    const baseDelay = this.options.baseDelayMs ?? 1000;
    const maxRetries = this.options.maxRetries ?? 5;

    while (this.active) {
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      try {
        const response = await fetch(this.url, {
          headers: {
            'Accept': 'text/event-stream',
            ...(this.options.headers || {})
          },
          signal
        });

        if (!response.ok) {
          throw new Error(`SSE HTTP failure: ${response.status}`);
        }

        this.options.onOpen?.();
        this.retries = 0; // reset retries

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (this.active) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep partial line in buffer

          let currentEvent = 'message';
          let currentData = '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              if (currentData) {
                this.options.onMessage?.(currentEvent, currentData.trim());
                currentData = '';
                currentEvent = 'message';
              }
              continue;
            }

            if (trimmed.startsWith(':')) continue; // Comment

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) continue;

            const key = trimmed.slice(0, colonIdx).trim();
            const val = trimmed.slice(colonIdx + 1).trim();

            if (key === 'event') {
              currentEvent = val;
            } else if (key === 'data') {
              currentData += val + '\n';
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          break; // Explicitly disconnected
        }

        this.options.onError?.(err);

        this.retries++;
        if (this.retries > maxRetries) {
          this.active = false;
          this.options.onError?.(new Error('Max SSE reconnection retries reached'));
          break;
        }

        // Delay with backoff
        const delay = baseDelay * Math.pow(2, this.retries - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}
