export interface WebSocketClientOptions {
  headers?: Record<string, string>;
  maxRetries?: number;
  baseDelayMs?: number;
  heartbeatIntervalMs?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (data: string) => void;
  onError?: (err: any) => void;
}

export class WebSocketClient {
  private ws: any = null;
  private active = false;
  private retries = 0;
  private heartbeatTimer: any = null;

  constructor(
    private url: string,
    private options: WebSocketClientOptions = {},
  ) {}

  connect(): void {
    if (this.active) return;
    this.active = true;
    this.retries = 0;
    this.establishConnection();
  }

  disconnect(): void {
    this.active = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(data);
    } else {
      throw new Error('WebSocket is not open');
    }
  }

  private establishConnection(): void {
    if (!this.active) return;

    // Use native WebSocket or import ws in Node
    const WSImpl = (globalThis as any).WebSocket || require('ws');

    try {
      this.ws = new WSImpl(this.url);

      this.ws.onopen = () => {
        this.retries = 0;
        this.startHeartbeat();
        this.options.onOpen?.();
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.options.onClose?.();
        this.handleReconnect();
      };

      this.ws.onerror = (err: any) => {
        this.options.onError?.(err);
      };

      this.ws.onmessage = (event: any) => {
        this.options.onMessage?.(event.data);
      };
    } catch (err) {
      this.options.onError?.(err);
      this.handleReconnect();
    }
  }

  private handleReconnect(): void {
    if (!this.active) return;

    const maxRetries = this.options.maxRetries ?? 5;
    const baseDelay = this.options.baseDelayMs ?? 1000;

    this.retries++;
    if (this.retries > maxRetries) {
      this.active = false;
      this.options.onError?.(
        new Error('Max WebSocket reconnection retries reached'),
      );
      return;
    }

    const delay = baseDelay * Math.pow(2, this.retries - 1);
    setTimeout(() => this.establishConnection(), delay);
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalMs ?? 30000;
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      try {
        this.send('ping');
      } catch (err) {
        // Ping failed, close connection to trigger reconnect
        this.ws?.close();
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
