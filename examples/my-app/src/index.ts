import { useAuth } from '@axiomify/auth';
import { Axiomify, UnauthorizedError, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { useLogger } from '@axiomify/logger';
import { useOpenAPI } from '@axiomify/openapi';
import { useRateLimit } from '@axiomify/rate-limit';
import { useUpload } from '@axiomify/upload';
import { useWebSockets } from '@axiomify/ws';
import { useMetrics } from '@axiomify/metrics';
import { serveStatic } from '@axiomify/static';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import path from 'path';

export const app = new Axiomify();

// To log requests, responses, and errors in a structured way, with zero config:
useLogger(app);

// Initialize Prometheus Metrics (available at GET /metrics)
useMetrics(app);

// 2. Serve Static Assets (e.g., GET /assets/logo.png)
serveStatic(app, {
  prefix: '/assets',
  root: path.join(process.cwd(), 'public'),
});

// Initialize plugins
useRateLimit(app, { max: 5, windowMs: 60_000 }); // 50 requests per minute globally
useAuth(app, { secret: 'super-secret-jwt-key' });

// A strictly validated route
app.route({
  method: 'POST',
  path: '/api/users',

  schema: {
    body: z.object({
      username: z.string().min(3).describe('The new username'),
      role: z.enum(['admin', 'user']).default('user').describe('The user role'),
    }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: 1, ...req.body }, 'User created successfully');
  },
});

// Enable the Upload Engine
useUpload(app);
app.route({
  method: 'POST',
  path: '/api/users/avatar',
  schema: {
    // Standard text validation runs AFTER the multipart fields are parsed!
    body: z.object({
      userId: z.string().uuid(),
    }),

    // 🚀 Declarative File Uploads
    files: {
      avatar: {
        maxSize: 5 * 1024 * 1024, // 5MB limit
        accept: ['image/png', 'image/jpeg'],
        autoSaveTo: path.join(__dirname, '../uploads'),

        // The dynamic rename hook!
        rename: (originalName, mimetype) => {
          const ext = mimetype === 'image/png' ? '.png' : '.jpg';
          return `avatar_${randomUUID()}${ext}`;
        },
      },
    },
  },
  handler: async (req, res) => {
    // At this point, the file is ALREADY saved to disk safely,
    // sized-checked, type-checked, and renamed.
    const avatarData = req.files!['avatar'];

    res.status(201).send(
      {
        fileDetails: avatarData,
      },
      'Avatar updated successfully',
    );
  },
});

// Generate Swagger Docs automatically
useOpenAPI(app, {
  routePrefix: '/docs',
  info: { title: 'Axiomify Test API', version: '1.0.0' },
});

app.route({
  method: 'GET',
  path: '/api/secure-data',
  handler: async (req, res) => {
    const isAuthed = false; // logic here

    if (!isAuthed) {
      // 🚀 Just throw! The engine catches it and sends a 401 JSON automatically.
      throw new UnauthorizedError('You do not have access to this.');
    }

    res.send({});
  },
});

app.route({
  method: 'GET',
  path: '/protected/data',
  plugins: ['requireAuth'], // 🚀 Strict IntelliSense here!
  handler: async (req, res) => {
    // req.user is fully typed and available!
    res.send({ accessedBy: req.user?.id });
  },
});

app.route({
  method: 'GET',
  path: '/ping',
  schema: {
    response: z.object({
      message: z.string(),
    }),
  },
  handler: async (req, res) => {
    res.status(200).send({ message: 'pong' });
  },
});

//  REST Streaming Example (Large File)
app.route({
  method: 'GET',
  path: '/download',
  handler: async (req, res) => {
    const fileStream = createReadStream('./large-video.mp4');
    res.stream(fileStream, 'video/mp4');
  },
});

// REST SSE Example (Live Updates)
app.route({
  method: 'GET',
  path: '/live-feed',
  handler: async (req, res) => {
    res.sseInit();

    const interval = setInterval(() => {
      res.sseSend({ time: Date.now() }, 'tick');
    }, 1000);

    req.raw.on('close', () => clearInterval(interval)); // Cleanup on disconnect
  },
});

if (require.main === module) {
  const adapter = new ExpressAdapter(app);
  const server = adapter.listen(3000, () => {
    console.log('🚀 Axiomify engine online on port 3000');
  });

  // 2. Initialize WebSockets
  const wsManager = useWebSockets({
    server,
    path: '/ws',
    authenticate: async (req) => {
      // Return true/user object to allow connection, or null to reject 401
      return { id: 'user-123' };
    },
  });

  // 3. Register a strictly typed WS event
  wsManager.on(
    'chat:message',
    z.object({ room: z.string(), text: z.string() }), // Zod Validation!
    (client, data) => {
      // If we reach here, data is guaranteed to match the Zod schema
      wsManager.joinRoom(client, data.room);
      wsManager.broadcastToRoom(data.room, 'chat:received', {
        sender: client.user.id,
        text: data.text,
      });
    },
  );

  // Signal Handling for Production
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received. Closing Axiomify engine...`);

    // 1. Stop accepting new connections
    // 2. Wait for existing requests to finish (default node behavior)
    server.close(() => {
      console.log('🤝 All active requests finished. Server closed.');
      process.exit(0);
    });

    // 3. Force shutdown after 10s if hanging
    setTimeout(() => {
      console.error(
        '⚠️ Could not close connections in time, forcing shut down',
      );
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT')); // Handles Ctrl+C
}
