import { createAuthPlugin } from '@axiomify/auth';
import { Axiomify, z } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';
import { useGraphQL } from '@axiomify/graphql';
import { useHelmet } from '@axiomify/helmet';
import { useLogger } from '@axiomify/logger';
import { useOpenAPI } from '@axiomify/openapi';
import { serveStatic } from '@axiomify/static';
import { useUpload } from '@axiomify/upload';
import { randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import path from 'path';

export const app = new Axiomify();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

const requireAuth = createAuthPlugin({
  secret: getRequiredEnv('JWT_SECRET'),
});

useHelmet(app);

useLogger(app);
serveStatic(app, {
  prefix: '/assets',
  root: path.join(process.cwd(), 'public'),
  serveIndex: true,
});

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      hello: {
        type: GraphQLString,
        resolve: (_root, _args, ctx) =>
          `Hello, ${ctx.user?.name ?? 'stranger'}`,
      },
    },
  }),
});
useGraphQL(app, { schema });

// useLogger(app);
// useMetrics(app);

// serveStatic(app, {
//   prefix: '/assets',
//   root: path.join(process.cwd(), 'public'),
// });

// useRateLimit(app, { max: 5, windowMs: 60_000 });

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
      userId: z.string(),
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
    const avatarData = req.files?.avatar;
    if (!avatarData) {
      res.status(400).send(null, 'avatar file is required');
      return;
    }
    res
      .status(201)
      .send({ fileDetails: avatarData }, 'Avatar updated successfully');
  },
});

app.route({
  method: 'GET',
  path: '/api/secure-data',
  plugins: [requireAuth],
  handler: async (req, res) => {
    res.send({ accessedBy: req.state.user?.id });
  },
});

app.route({
  method: 'GET',
  path: '/protected/data',
  plugins: [requireAuth],
  handler: async (req, res) => {
    res.send({ accessedBy: req.state.user?.id });
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

app.group('/api', (admin) => {
  admin.route({
    path: '/login',
    method: 'GET',
    handler: (_req, res) => {
      res.status(200).send({ status: 'success' });
    },
  });
});

app.route({
  method: 'GET',
  path: '/download',
  handler: async (_req, res) => {
    const filePath = path.join(process.cwd(), 'large-video.mp4');
    if (!existsSync(filePath)) {
      res.status(404).send(null, 'File not found');
      return;
    }
    const fileStream = createReadStream(filePath);
    fileStream.on('error', () =>
      res.status(500).send(null, 'Failed to read file'),
    );
    res.stream(fileStream, 'video/mp4');
  },
});
/* 
app.route({
  method: 'GET',
  path: '/live-feed',
  // sse: true,
  handler: async (req, res) => {
    res.sseInit();
    const interval = setInterval(() => {
      res.sseSend({ time: Date.now() }, 'tick');
    }, 1000);
    (req.raw as any).on('close', () => clearInterval(interval));
  },
}); */

useOpenAPI(app, {
  routePrefix: '/docs',
  info: { title: 'Axiomify Test API', version: '1.0.0' },
});

if (require.main === module) {
  const adapter = new FastifyAdapter(app /* { port: 3000 } */);
  adapter.listen(3000, () => {
    console.log('🚀 Axiomify engine online on port 3000');
    console.log('GraphQL ready at http://localhost:3000/graphql');
    console.log('Playground at   http://localhost:3000/graphql/playground');
  });
  /* const server = adapter.listenClustered({
    onPrimary: (pids) => {
      console.log(pids);
      console.log('🚀 Axiomify engine online on port 3000');
      console.log('GraphQL ready at http://localhost:3000/graphql');
      console.log('Playground at   http://localhost:3000/graphql/playground');
    },
    onWorkerReady() {
      console.log('Worker ready');
    },
    onWorkerExit: (pid) => console.log(`${pid} exit`),
  }); */

  // Note: two arguments. `useWebSockets` returns void; the manager is
  // attached to the app as `(app as any).ws`.
  /* useWebSockets(app, {
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
        sender: (client.user as any).id,
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
  process.once('SIGINT', () => shutdown('SIGINT')); */
}
