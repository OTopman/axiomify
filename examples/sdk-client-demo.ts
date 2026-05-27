/**
 * @axiomify/sdk-runtime — Demo client code showing how to consume a generated SDK.
 *
 * Demonstrates:
 * - SDK Client initialization with environment configurations
 * - Network resilience (Retries, Circuit Breaker, Caching, Request Deduplication)
 * - Custom request/response/error Interceptors
 * - Authentication (Static tokens and OAuth2 client credentials flows)
 * - Paged collections using Cursor-based Paginators
 * - Offline Queueing for client-side resilience
 * - Streaming clients (Server-Sent Events and WebSockets)
 */
import {
  BaseClient,
  StaticTokenProvider,
  OAuth2BearerProvider,
  SseClient,
  WebSocketClient,
  Paginator,
  OfflineQueue,
  EnvironmentSwitcher,
  ClientRequest,
  ClientResponse,
} from '@axiomify/sdk-runtime';

// ============================================================================
// 1. Environment Configurations
// ============================================================================
const environments = {
  production: 'https://api.axiomify.io/v1',
  staging: 'https://api-staging.axiomify.io/v1',
  development: 'http://localhost:3000',
};

const switcher = new EnvironmentSwitcher(environments, 'development');
console.log(`Current URL: ${switcher.getUrl()}`); // http://localhost:3000

// We can switch environment dynamically
switcher.setEnvironment('production');
console.log(`Switched to URL: ${switcher.getUrl()}`); // https://api.axiomify.io/v1


// ============================================================================
// 2. Client Definition (Mocking a generated subclass)
// ============================================================================
class AxiomifyApiClient extends BaseClient {
  constructor(baseUrl: string, options: any = {}) {
    super({
      baseUrl,
      ...options,
    });
  }

  /**
   * Represents a generated endpoint call.
   * Internally, generated code invokes the protected `request` method.
   */
  async createUser(data: { email: string; name: string }): Promise<{ id: string; email: string; name: string }> {
    return this.request({
      path: '/users',
      method: 'POST',
      body: data,
    });
  }

  async getUser(id: string): Promise<{ id: string; email: string; name: string }> {
    return this.request({
      path: `/users/${id}`,
      method: 'GET',
    });
  }
  
  async listUsers(cursor?: string): Promise<{ items: any[]; nextCursor?: string }> {
    return this.request({
      path: '/users',
      method: 'GET',
      query: cursor ? { cursor } : undefined,
    });
  }
}


// ============================================================================
// 3. Client Instance & Advanced Config
// ============================================================================
const authProvider = new StaticTokenProvider('Bearer my-secret-jwt-token');

// Alternatively, for OAuth2 client credentials:
// const authProvider = new OAuth2BearerProvider(
//   'https://auth.axiomify.io/oauth/token',
//   'client_id_123',
//   'client_secret_xyz'
// );

const client = new AxiomifyApiClient(switcher.getUrl(), {
  authProvider,
  timeoutMs: 5000,
  
  // Cache config (applies to GET requests)
  enableCache: true,
  cacheTtlMs: 30000, // 30 seconds cache TTL
  
  // Retry engine with exponential backoff & jitter
  retryConfig: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 3000,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  },
  
  // Circuit Breaker config to shield downstream services
  circuitBreakerConfig: {
    failureThreshold: 5,       // Open after 5 consecutive errors
    cooldownPeriodMs: 10000,    // Remain open for 10 seconds before half-open state
    halfOpenMaxProbeRequests: 3 // 3 probe requests to check if backend is healthy
  },
  
  // Telemetry hooks
  telemetry: {
    onBeforeRequest: (req: ClientRequest) => {
      console.log(`[Telemetry] Sending ${req.method} request to ${req.path}`);
    },
    onAfterResponse: (res: ClientResponse) => {
      console.log(`[Telemetry] Received response with status ${res.status}`);
    },
    onError: (err: any) => {
      console.error(`[Telemetry] Request failed: ${err.message}`);
    }
  }
});


// ============================================================================
// 4. Interceptors (Adding custom request/response logic)
// ============================================================================
// Add request interceptor
client.interceptors.request.use((req) => {
  req.headers = req.headers || {};
  req.headers['X-Client-Timestamp'] = Date.now().toString();
  return req;
});

// Add response interceptor
client.interceptors.response.use((res) => {
  if (res.status === 401) {
    console.warn('Unauthorized request detected! Refreshing authentication...');
  }
  return res;
});


// ============================================================================
// 5. Cursor Paged Navigation
// ============================================================================
async function runPaginatorExample() {
  const paginator = new Paginator<any, { cursor?: string }>({
    fetchPage: async (params) => {
      const res = await client.listUsers(params.cursor);
      return {
        items: res.items,
        nextCursor: res.nextCursor,
        hasMore: !!res.nextCursor,
      };
    },
    initialParams: {},
    cursorParamName: 'cursor',
  });

  console.log('Fetching first page of users...');
  const page1 = await paginator.nextPage();
  console.log(`Page 1 items count: ${page1.length}`);

  if (paginator.hasNext()) {
    console.log('Fetching second page of users...');
    const page2 = await paginator.nextPage();
    console.log(`Page 2 items count: ${page2.length}`);
  }
}


// ============================================================================
// 6. Offline Queueing
// ============================================================================
const offlineQueue = new OfflineQueue();

// Register online event listeners automatically (in-browser) or manually
function simulateOfflineMode() {
  console.log('Simulating offline state. Queueing actions...');
  
  // Queue requests to be flushed later
  offlineQueue.enqueue({
    path: '/users',
    method: 'POST',
    body: { name: 'Offline John', email: 'john.offline@example.com' },
  });

  console.log(`Offline Queue size: ${offlineQueue.getQueue().length}`);

  // Flush queued requests once connection is restored
  offlineQueue.flush(async (queued) => {
    console.log(`Processing queued request: ${queued.method} ${queued.path}`);
    if (queued.method === 'POST' && queued.path === '/users') {
      await client.createUser(queued.body);
    }
  });
}


// ============================================================================
// 7. Event & Client Streaming (SSE and WebSockets)
// ============================================================================
function setupStreamingDemo() {
  // 7.1 Server-Sent Events (SSE) Client
  const sse = new SseClient('http://localhost:3000/live-feed', {
    headers: {
      Authorization: 'Bearer token123',
    },
    maxRetries: 5,
    onOpen: () => {
      console.log('SSE connection established');
    },
    onMessage: (event, data) => {
      console.log(`SSE Message received: event=${event}, data=${data}`);
    },
    onError: (err) => {
      console.error('SSE connection error:', err.message);
    },
  });

  // Start listening
  // sse.connect();
  
  // Stop listening when done
  // sse.disconnect();

  // 7.2 WebSocket Client
  const ws = new WebSocketClient('ws://localhost:3000/chat', {
    heartbeatIntervalMs: 20000, // send ping every 20s
    onOpen: () => {
      console.log('WebSocket client online');
      ws.send(JSON.stringify({ type: 'join', room: 'lobby' }));
    },
    onMessage: (data) => {
      console.log('WebSocket Message:', data);
    },
    onError: (err) => {
      console.error('WebSocket Error:', err);
    },
    onClose: () => {
      console.log('WebSocket client connection closed');
    },
  });

  // Connect to websocket
  // ws.connect();
  
  // Disconnect from websocket
  // ws.disconnect();
}

// Export demo wrappers
export { runPaginatorExample, simulateOfflineMode, setupStreamingDemo };
