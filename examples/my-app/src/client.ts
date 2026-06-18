import { BaseClient, StaticTokenProvider, SseClient } from '@axiomify/sdk-runtime';
import { sign } from 'jsonwebtoken';
import { readFileSync } from 'fs';
import path from 'path';
import { io } from 'socket.io-client';

// 1. Read JWT secret from .env file
console.log('📖 Loading configuration...');
let jwtSecret = 'default_fallback_secret_at_least_32_bytes_long';
try {
  const envPath = path.join(__dirname, '../.env');
  const envContent = readFileSync(envPath, 'utf8');
  const match = envContent.split('\n').find((line) => line.startsWith('JWT_SECRET='));
  if (match) {
    jwtSecret = match.split('=')[1].trim();
  }
} catch (e) {
  console.warn('⚠️ Could not read .env file, falling back to default secret');
}

// 2. Generate a signed JWT token for a mock user
const token = sign({ id: 'user_99', name: 'Axiomify Explorer', role: 'admin' }, jwtSecret);
console.log(`🔑 Generated token: ${token.substring(0, 20)}...`);

// 3. Subclass BaseClient for type-safe API requests
class AxiomifyApiClient extends BaseClient {
  constructor(baseUrl: string, options: any = {}) {
    super({
      baseUrl,
      ...options,
    });
  }

  async ping() {
    return this.request({ path: '/ping', method: 'GET' });
  }

  async getSecureData() {
    return this.request({ path: '/api/secure-data', method: 'GET' });
  }

  async checkout(payload: { email: string; name: string; amount: number; simulateFailure?: boolean }) {
    return this.request({
      path: '/api/checkout',
      method: 'POST',
      body: payload,
    });
  }
}

// 4. Instantiate SDK Client
const authProvider = new StaticTokenProvider(`Bearer ${token}`);
const client = new AxiomifyApiClient('http://localhost:3000', {
  authProvider,
  enableCache: false,
});

async function main() {
  console.log('\n--- 🩺 Phase 1: Checking Service Health ---');
  try {
    const pingRes = await client.ping();
    console.log('✅ Ping Response:', pingRes);
  } catch (err: any) {
    console.error('❌ Ping Failed:', err.message);
    return;
  }

  console.log('\n--- 🛡️ Phase 2: Requesting Fingerprinted & Rate-Limited Endpoint ---');
  try {
    // Make 3 requests to show fingerprint identification and rate-limit headers
    for (let i = 1; i <= 3; i++) {
      const secureRes = await client.getSecureData();
      console.log(`[Req ${i}] Secure Data Response:`, secureRes);
    }
  } catch (err: any) {
    console.error('❌ Secure Data request failed:', err.message);
  }

  console.log('\n--- 💼 Phase 3: Executing Distributed Sagas and Background Jobs ---');
  try {
    // 3.1 Checkout with success
    console.log('⚡ Triggering a successful Checkout Saga...');
    const checkoutSuccess = await client.checkout({
      email: 'explorer@axiomify.io',
      name: 'Axiomify Explorer',
      amount: 250.0,
      simulateFailure: false,
    });
    console.log('✅ Checkout Outcome:', checkoutSuccess);

    // Wait 1 second for background workers to print messages
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3.2 Checkout with simulation failure (should trigger rollbacks/compensations)
    console.log('\n⚡ Triggering a failing Checkout Saga (simulating db crash)...');
    await client.checkout({
      email: 'failed_explorer@axiomify.io',
      name: 'Failed Explorer',
      amount: 120.0,
      simulateFailure: true,
    }).then((res) => {
      console.log('❌ Unexpected Checkout Success:', res);
    }).catch((err) => {
      console.log('✅ Checkout Rejected as expected:', err.message);
    });

    // Wait 1 second for background compensation workers to print messages
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (err: any) {
    console.error('❌ Saga run failed:', err.message);
  }

  console.log('\n--- 📡 Phase 4: Connecting Server-Sent Events (SSE) stream ---');
  const sse = new SseClient('http://localhost:3000/live-feed', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    onOpen: () => {
      console.log('🔌 SSE client connected and listening to live-feed!');
    },
    onMessage: (event, data) => {
      console.log(`📡 [SSE Event] name="${event}", payload=${data}`);
    },
    onError: (err) => {
      console.error('❌ SSE Error:', err.message);
    },
  });
  sse.connect();

  console.log('\n--- ⚡ Phase 5: Connecting Socket.IO Client Bridge ---');
  // Connect Socket.IO client using upgrade headers for authentication
  const socket = io('http://localhost:3000', {
    extraHeaders: {
      Authorization: `Bearer ${token}`,
    },
  });

  socket.on('connect', () => {
    console.log(`🔌 [Socket.IO] Connected! client ID: ${socket.id}`);
    
    // Send a chat message
    console.log('💬 [Socket.IO] Sending chat message to server...');
    socket.emit('chat', 'Hello, Axiomify monorepo!');
  });

  socket.on('chat', (data: any) => {
    console.log(`💬 [Socket.IO] Received Broadcast chat:`, data);
  });

  socket.on('connect_error', (err) => {
    console.error('❌ [Socket.IO] Handshake failed:', err.message);
  });

  // Keep process alive briefly, then clean up
  setTimeout(() => {
    console.log('\n👋 Closing client demo connections...');
    sse.disconnect();
    socket.disconnect();
    process.exit(0);
  }, 4000);
}

main().catch(console.error);
