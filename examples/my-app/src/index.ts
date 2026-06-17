import { createAuthPlugin } from '@axiomify/auth';
import { AppModule, Axiomify, z } from '@axiomify/core';
import { useCors } from '@axiomify/cors';
import { useFingerprint } from '@axiomify/fingerprint';
import { useGraphQL } from '@axiomify/graphql';
import { useHelmet } from '@axiomify/helmet';
import { jobsModule, SagaCoordinator } from '@axiomify/jobs';
import { useLogger } from '@axiomify/logger';
import { useMetrics } from '@axiomify/metrics';
import { useOpenAPI } from '@axiomify/openapi';
import { createRateLimitPlugin } from '@axiomify/rate-limit';
import { useSecurity } from '@axiomify/security';
import { adaptAxiomifyPlugin, attachSocketIO } from '@axiomify/socket.io';
import { serveStatic } from '@axiomify/static';
import { useUpload } from '@axiomify/upload';
import { vaultModule } from '@axiomify/vault';
import { wsRooms } from '@axiomify/ws';
import { randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { GraphQLInt, GraphQLList, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import path from 'path';

export const app = new Axiomify();
app.enableTracing();

const room = wsRooms(app, {
  path: '/ws',
  schema: z.object({
    action: z.string(),
    room: z.string().optional(),
    data: z.any().optional(),
  }),
  onConnect(client) {
    client.join('lobby');
    console.log('A client connected.');
  },
  onMessage(client, data) {
    console.log('A client sent a message.', data);
    console.log(client.rooms);
  },
});

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

const requireAuth = createAuthPlugin({
  secret: getRequiredEnv('JWT_SECRET'),
});

// Configure Rate Limiter (fingerprint-keyed)
const rateLimiter = createRateLimitPlugin({
  windowMs: 60000,
  max: 10,
  allowMemoryStoreInProduction: true,
  keyGenerator: (req) => req.state.fingerprint ?? req.ip ?? 'unknown',
});

// Apply Security, Helmet, CORS, and Fingerprint globally
useHelmet(app);
useCors(app, {
  origin: '*',
  credentials: false,
});
useSecurity(app, {
  xssProtection: true,
  hppProtection: true,
  botProtection: false,
});
useFingerprint(app, {
  algorithm: 'sha256',
  trustProxyHeaders: true,
});

useMetrics(app, {
  path: '/metrics',
  wsManager: room,
});

useLogger(app, {
  includeBody: true,
  includeHeaders: true,
  includeResponseHeaders: true,
  includeState: true,
});

serveStatic(app, {
  prefix: '/assets',
  root: path.join(process.cwd(), 'public'),
  serveIndex: true,
});

export class UserService {
  private users = [
    { id: 1, username: 'alice', role: 'admin' as const },
    { id: 2, username: 'bob', role: 'user' as const },
  ];

  public async getUsers() {
    return this.users;
  }

  public async getUser(id: number) {
    return this.users.find((u) => u.id === id);
  }

  public async createUser(username: string, role: 'admin' | 'user') {
    const newUser = {
      id: this.users.length + 1,
      username,
      role,
    };
    this.users.push(newUser);
    return newUser;
  }
}

declare module '@axiomify/core' {
  interface AppServices {
    userService: UserService;
  }
}

// Enable vault module configuration
app.use(vaultModule({
  modules: {
    services: { allow: ['JWT_SECRET'] },
  },
}));

// Enable distributed background jobs module
app.use(jobsModule({
  storage: 'memory',
  pollIntervalMs: 500,
  maxConcurrency: 3,
}));

const servicesModule: AppModule = {
  name: 'services',
  dependencies: ['jobs'],
  register: (_app, ctx) => {
    ctx.provide('userService', new UserService());

    // Register Background Job Executors
    const jobs = ctx.resolve('jobs');
    jobs.register('send-welcome-email', async (payload: { email: string; name: string }) => {
      console.log(`[Worker] Sending welcome email to ${payload.name} at ${payload.email}...`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(`[Worker] Welcome email sent successfully to ${payload.email}!`);
    });

    jobs.register('process-payment', async (payload: { amount: number }) => {
      console.log(`[Worker] Charging card for $${payload.amount}...`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      console.log(`[Worker] Card charged successfully!`);
    });

    jobs.register('refund-payment', async (payload: { amount: number }) => {
      console.log(`[Compensation] Refunding card charge of $${payload.amount}...`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(`[Compensation] Refund processed successfully.`);
    });
  },
};

const usersModule: AppModule = {
  name: 'users',
  dependencies: ['services'],
  register: (app, ctx) => {
    const userService = ctx.resolve('userService');

    app.route({
      method: 'GET',
      path: '/api/users',
      schema: {
        response: z.array(
          z.object({
            id: z.number(),
            username: z.string(),
            role: z.enum(['admin', 'user']),
          })
        ),
      },
      handler: async (_req, res) => {
        const users = await userService.getUsers();
        res.status(200).send(users);
      },
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
        const newUser = await userService.createUser(req.body.username, req.body.role);
        res.status(201).send(newUser, 'User created successfully');
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

    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          hello: {
            type: GraphQLString,
            resolve: (_root, _args, context) =>
              `Hello, ${context.user?.name ?? 'stranger'}`,
          },
          users: {
            type: new GraphQLList(
              new GraphQLObjectType({
                name: 'User',
                fields: {
                  id: { type: GraphQLInt },
                  username: { type: GraphQLString },
                  role: { type: GraphQLString },
                },
              })
            ),
            resolve: async () => {
              return await userService.getUsers();
            },
          },
        },
      }),
    });
    useGraphQL(app, { schema });
  },
};

// Checkout Saga coordinator module
const checkoutModule: AppModule = {
  name: 'checkout',
  dependencies: ['jobs'],
  register: (app, ctx) => {
    const jobs = ctx.resolve('jobs');

    app.route({
      method: 'POST',
      path: '/api/checkout',
      schema: {
        body: z.object({
          email: z.string().email(),
          name: z.string(),
          amount: z.number().positive(),
          simulateFailure: z.boolean().default(false),
        }),
      },
      handler: async (req, res) => {
        const saga = new SagaCoordinator(jobs);
        const { email, name, amount, simulateFailure } = req.body;

        saga.addStep(
          'charge-payment',
          async () => {
            console.log(`[Saga] Charging payment of $${amount} for ${email}`);
            await jobs.enqueue('process-payment', { amount });
            return { ok: true };
          },
          async () => {
            console.log(`[Saga Rollback] Checkout failed, refunding payment of $${amount}`);
            await jobs.enqueue('refund-payment', { amount });
          }
        );

        saga.addStep(
          'create-profile',
          async () => {
            console.log(`[Saga] Creating user profile for ${name}`);
            if (simulateFailure) {
              throw new Error('Checkout simulation error: database write failed');
            }
            return { profileId: 'prof_' + randomUUID().substring(0, 8) };
          },
          async () => {
            console.log(`[Saga Rollback] Checkout failed, reversing user profile changes`);
          }
        );

        const outcome = await saga.execute({ email, name });

        if (outcome.success) {
          await jobs.enqueue('send-welcome-email', { email, name });
          res.status(200).send({
            status: 'success',
            message: 'Checkout successful, welcome email queued',
            outcome,
          });
        } else {
          res.status(500).send({
            status: 'failed',
            message: 'Checkout failed, compensating rollbacks queued',
            error: outcome.error,
          });
        }
      },
    });
  },
};

app.use(servicesModule);
app.use(usersModule);
app.use(checkoutModule);

app.route({
  method: 'GET',
  path: '/api/secure-data',
  plugins: [requireAuth, rateLimiter],
  handler: async (req, res) => {
    res.send({
      accessedBy: req.state.user?.id,
      fingerprint: req.state.fingerprint,
      fingerprintConfidence: req.state.fingerprintConfidence,
    });
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

app.route({
  method: 'GET',
  path: '/live-feed',
  handler: async (req, res) => {
    res.sseInit!();
    const interval = setInterval(() => {
      res.sseSend!({ time: Date.now() }, 'tick');
    }, 1000);
    req.signal!.addEventListener('abort', () => clearInterval(interval));
  },
});

useOpenAPI(app, {
  prefix: '/docs',
  info: { title: 'Axiomify Test API', version: '1.0.0' },
});

if (require.main === module) {
  app.build();

  import('@axiomify/native').then(({ NativeAdapter }) => {
    const adapter = new NativeAdapter(app, { port: 3000 });

    // Attach Socket.IO
    attachSocketIO(adapter, {
      cors: { origin: '*' },
    }).then((io) => {
      // Adapt the requireAuth middleware to authenticate socket connections
      io.use(adaptAxiomifyPlugin(requireAuth));

      io.on('connection', (socket) => {
        console.log(`⚡ [Socket.IO] Client connected: ${socket.id}`);
        console.log(`👤 [Socket.IO] User metadata:`, socket.data.user);

        socket.on('chat', (data) => {
          console.log(`💬 [Socket.IO] chat msg:`, data);
          io.emit('chat', { sender: socket.id, message: data });
        });

        socket.on('disconnect', () => {
          console.log(`🔌 [Socket.IO] Client disconnected: ${socket.id}`);
        });
      });
    });

    adapter.listen(() => {
      console.log('🚀 Axiomify engine online on port 3000');
      console.log('GraphQL ready at http://localhost:3000/graphql');
      console.log('Playground at   http://localhost:3000/graphql/playground');

      // Start the jobs scheduler using internal resolution
      const jobs = (app as any)._services.get('jobs');
      if (jobs) {
        jobs.start();
      }
    });
  });
}
