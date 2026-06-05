
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NodeSDK } from '@opentelemetry/sdk-node';


import { createAuthPlugin } from '@axiomify/auth';
import { AppModule, Axiomify, z } from '@axiomify/core';
import { useGraphQL } from '@axiomify/graphql';
import { useHelmet } from '@axiomify/helmet';
import { useLogger } from '@axiomify/logger';
import { useMetrics } from '@axiomify/metrics';
import { useOpenAPI } from '@axiomify/openapi';
import { serveStatic } from '@axiomify/static';
import { useUpload } from '@axiomify/upload';
import { wsRooms } from '@axiomify/ws';
import { randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { GraphQLInt, GraphQLList, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import path from 'path';

export const app = new Axiomify();

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

useHelmet(app);
useMetrics(app, {
  path: '/metrics',
  wsManager: room
});

useLogger(app);
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

const servicesModule: AppModule = {
  name: 'services',
  register: (_app, ctx) => {
    ctx.provide('userService', new UserService());

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

app.use(servicesModule);
app.use(usersModule);

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

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `http://localhost:3000/metrics` // collector endpoint
    }),
    instrumentations: [getNodeAutoInstrumentations()]
  });

  // Start SDK before booting Axiomify app
  sdk.start();
  import('@axiomify/native').then(({ NativeAdapter }) => {
    const adapter = new NativeAdapter(app, { port: 3000 });
    adapter.listen(() => {
      console.log('🚀 Axiomify engine online on port 3000');
      console.log('GraphQL ready at http://localhost:3000/graphql');
      console.log('Playground at   http://localhost:3000/graphql/playground');
    });
  });
}
