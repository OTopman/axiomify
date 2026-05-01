import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { createReadStream, writeFileSync } from 'fs';
import { join } from 'path';
import { WebSocket } from 'ws'; // Used only as a client for testing

const app = new Axiomify();
const port = 3000;

// 1. File Upload Test (Testing readBody & Buffer handling)
app.route({
  method: 'POST',
  path: '/upload',
  handler: async (req, res) => {
    const fileSize = (req.body as Buffer).length;
    console.log(`[Test] Received file upload: ${fileSize} bytes`);
    res.send({ status: 'uploaded', size: fileSize });
  },
});

// 2. Large Asset Test (Testing the stream() patch)
app.route({
  method: 'GET',
  path: '/download',
  handler: async (req, res) => {
    // Create a dummy 1MB file for testing
    const dummyPath = join(__dirname, 'dummy.txt');
    writeFileSync(dummyPath, Buffer.alloc(1024 * 1024, 'A'));

    res.header('Content-Type', 'text/plain');
    res.stream(createReadStream(dummyPath));
  },
});

// Start the Native Adapter
const adapter = new NativeAdapter(app, { port });
adapter.listen();

// --- CLIENT TEST RUNNER ---
setTimeout(async () => {
  console.log('\n--- Starting Simultaneous Integration Test ---\n');

  // Test A: WebSocket Connection
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  ws.on('open', () => {
    console.log('[Client] WS Connected. Sending ping...');
    ws.send('Axiomify Native Check');
  });
  ws.on('message', (data) => {
    console.log(`[Client] WS Received: ${data}`);
    ws.close();
  });

  // Test B: Large File Upload (Simulating @axiomify/upload)
  const bigBuffer = Buffer.alloc(5 * 1024 * 1024, 'B'); // 5MB
  console.log('[Client] Starting 5MB Upload...');

  const uploadResponse = await fetch(`http://localhost:${port}/upload`, {
    method: 'POST',
    body: bigBuffer,
    headers: { 'Content-Type': 'application/octet-stream' },
  });

  const result = await uploadResponse.json();
  console.log(`[Client] Upload Server Response:`, result);
}, 1000);
