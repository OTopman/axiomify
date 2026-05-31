/**
 * @axiomify/ws — Native Pub/Sub Room Server Example.
 *
 * Demonstrates:
 * - Registering the Room Manager on an Axiomify App using `wsRooms()`
 * - Schema-validated WebSocket message payloads via Zod
 * - Automatic wire-protocol actions (join, leave, message, presence)
 * - Broadcasting O(1) messages to rooms natively via uWS
 * - Room lifecycle, presence management, and authentication hook integration
 */
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { wsRooms } from '@axiomify/ws';
import { z } from 'zod';

const app = new Axiomify();

// Opt-in request ID generation
app.enableRequestId();

// Health check endpoint
app.route({
  method: 'GET',
  path: '/health',
  handler: async (_req, res) => res.send({ status: 'ok', uptime: process.uptime() }),
});

// Configure the Room Manager at '/chat'
const rooms = wsRooms(app, {
  path: '/chat',
  allowlist: /.*/, // Allow joining any room (default is default-deny)
  maxRoomsPerClient: 5,
  presenceIntervalMs: 15000, // Presence update interval (heartbeat)
  schema: z.object({
    action: z.enum(['join', 'leave', 'message', 'presence']),
    room: z.string().min(1),
    data: z.any().optional(),
  }),
  plugins: [
    // Pre-upgrade middleware / plugin: Extract credentials from header or query string
    async (req, res) => {
      const auth = req.headers['authorization'] || req.query.token;
      if (auth && auth.startsWith('Bearer ')) {
        // Mock authentication validation:
        const token = auth.replace('Bearer ', '');
        req.state.user = { name: token, authenticated: true };
      } else {
        // Fallback for anonymous users:
        req.state.user = { name: `Anonymous_${Math.floor(Math.random() * 1000)}`, authenticated: false };
      }
    },
  ],
  onConnect(client) {
    console.log(`[SERVER] Client ${client.id} connected as ${client.state.user.name}`);
    
    // Send welcome frame with client ID and current state
    client.send({
      event: 'welcome',
      id: client.id,
      user: client.state.user,
    });
  },
  onDisconnect(client, code, reason) {
    console.log(`[SERVER] Client ${client.id} (${client.state.user.name}) disconnected. Code: ${code}, Reason: ${reason}`);
  },
});

// Register Room Manager event listeners for server-side logic
rooms.on('roomCreate', (roomName) => {
  console.log(`[SERVER] Room created: ${roomName}`);
});

rooms.on('roomDelete', (roomName) => {
  console.log(`[SERVER] Room deleted: ${roomName}`);
});

rooms.on('join', (roomName, client) => {
  console.log(`[SERVER] Client ${client.state.user.name} joined room: ${roomName}`);
  
  // Notify other members of the room using the room's native broadcast API
  rooms.room(roomName)?.broadcastExcept(client.id, {
    event: 'system',
    room: roomName,
    message: `${client.state.user.name} has joined the room.`,
  });
});

rooms.on('leave', (roomName, client) => {
  console.log(`[SERVER] Client ${client.state.user.name} left room: ${roomName}`);
  
  // Notify other members of the room using the room's native broadcast API
  rooms.room(roomName)?.broadcastExcept(client.id, {
    event: 'system',
    room: roomName,
    message: `${client.state.user.name} has left the room.`,
  });
});

rooms.on('message', (client, data: any) => {
  // Executed on every incoming validated text payload
  console.log(`[SERVER] Message from ${client.state.user.name}:`, data);
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const adapter = new NativeAdapter(app, { port: PORT });

adapter.listen(() => {
  console.log(`\n🚀 Chat room WebSocket server running on ws://localhost:${PORT}/chat`);
  console.log(`🤖 Send JSON frames to interact, e.g.:`);
  console.log(`   { "action": "join", "room": "lobby" }`);
  console.log(`   { "action": "message", "room": "lobby", "data": { "text": "Hello, Lobby!" } }\n`);
});
