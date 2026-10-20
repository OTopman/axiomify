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
export declare class WebSocketClient {
    private url;
    private options;
    private ws;
    private active;
    private retries;
    private heartbeatTimer;
    constructor(url: string, options?: WebSocketClientOptions);
    connect(): void;
    disconnect(): void;
    send(data: string): void;
    private establishConnection;
    private handleReconnect;
    private startHeartbeat;
    private stopHeartbeat;
}
//# sourceMappingURL=websocket.d.ts.map