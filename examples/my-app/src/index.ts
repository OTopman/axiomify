import { useAuth } from '@axiomify/auth';
import { Axiomify, UnauthorizedError, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { useLogger } from '@axiomify/logger';
import { useMetrics } from '@axiomify/metrics';
import { useOpenAPI } from '@axiomify/openapi';
import { useRateLimit } from '@axiomify/rate-limit';
import { serveStatic } from '@axiomify/static';
import { useUpload } from '@axiomify/upload';
import { useWebSockets, WsManager } from '@axiomify/ws';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import path from 'path';

export const app = new Axiomify();

useLogger(app);
useMetrics(app);

serveStatic(app, {
  prefix: '/assets',
  root: path.join(process.cwd(), 'public'),
});

useRateLimit(app, { max: 5, windowMs: 60_000 });
useAuth(app, {
  secret:
    process.env.JWT_SECRET ??
    (() => {
      throw new Error('JWT_SECRET env var is required');
    })(),
});

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

useUpload(app);
app.route({
  method: 'POST',
  path: '/api/users/avatar',
  schema: {
    body: z.object({
      userId: z.string().uuid(),
    }),
    files: {
      avatar: {
        maxSize: 5 * 1024 * 1024,
        accept: ['image/png', 'image/jpeg'],
        autoSaveTo: path.join(__dirname, '../uploads'),
        rename: (_originalName, mimetype) => {
          const ext = mimetype === 'image/png' ? '.png' : '.jpg';
          return `avatar_${randomUUID()}${ext}`;
        },
      },
    },
  },
  handler: async (req, res) => {
    const avatarData = req.files!['avatar'];
    res
      .status(201)
      .send({ fileDetails: avatarData }, 'Avatar updated successfully');
  },
});

useOpenAPI(app, {
  routePrefix: '/docs',
  info: { title: 'Axiomify Test API', version: '1.0.0' },
});

app.route({
  method: 'GET',
  path: '/api/secure-data',
  handler: async (_req, _res) => {
    const isAuthed = false;
    if (!isAuthed) {
      throw new UnauthorizedError('You do not have access to this.');
    }
  },
});

app.route({
  method: 'GET',
  path: '/protected/data',
  plugins: ['requireAuth'],
  handler: async (req, res) => {
    res.send({ accessedBy: req.user?.id });
  },
});

app.route({
  method: 'GET',
  path: '/ping',
  schema: {
    response: z.object({ message: z.string() }),
  },
  handler: async (_req, res) => {
    res.status(200).send({ message: 'pong' });
  },
});

app.route({
  method: 'GET',
  path: '/download',
  handler: async (_req, res) => {
    const fileStream = createReadStream('./large-video.mp4');
    res.stream(fileStream, 'video/mp4');
  },
});

app.route({
  method: 'GET',
  path: '/live-feed',
  handler: async (req, res) => {
    res.sseInit();
    const interval = setInterval(() => {
      res.sseSend({ time: Date.now() }, 'tick');
    }, 1000);
    (req.raw as any).on('close', () => clearInterval(interval));
  },
});

if (require.main === module) {
  const adapter = new ExpressAdapter(app);
  const server = adapter.listen(3000, () => {
    console.log('🚀 Axiomify engine online on port 3000');
  });

  // Note: two arguments. `useWebSockets` returns void; the manager is
  // attached to the app as `(app as any).ws`.
  useWebSockets(app, {
    server,
    path: '/ws',
    authenticate: async (_req) => ({ id: 'user-123' }),
  });
  const wsManager = (app as any).ws as WsManager;

  wsManager.on(
    'chat:message',
    z.object({ room: z.string(), text: z.string() }),
    (client, data) => {
      wsManager.joinRoom(client, data.room);
      wsManager.broadcastToRoom(data.room, 'chat:received', {
        sender: client.user.id,
        text: data.text,
      });
    },
  );

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received. Closing Axiomify engine...`);
    server.close(() => {
      console.log('🤝 All active requests finished. Server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error(
        '⚠️ Could not close connections in time, forcing shut down',
      );
      process.exit(1);
    }, 10000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
