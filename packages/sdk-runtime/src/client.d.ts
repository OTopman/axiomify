import { ClientConfig, ClientRequest } from './types';
import { InterceptorManager } from './interceptors';
export declare class BaseClient {
    protected config: ClientConfig;
    interceptors: InterceptorManager;
    private circuitBreaker;
    private cache;
    private inFlightRequests;
    constructor(config: ClientConfig);
    request<T = unknown>(req: ClientRequest): Promise<T>;
    private executeRequest;
    private createHeaders;
    private createCacheKey;
}
//# sourceMappingURL=client.d.ts.map