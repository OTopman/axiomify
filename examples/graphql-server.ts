/**
 * graphql-server.ts
 *
 * Demonstrates @axiomify/graphql alongside REST routes on the same server.
 * Run: npx ts-node examples/graphql-server.ts
 */

import { Axiomify, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import {
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import { useGraphQL } from '@axiomify/graphql';

// ─── Fake data store ──────────────────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  email: string;
}

const users: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

// ─── GraphQL Schema ───────────────────────────────────────────────────────────

const UserType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID) },
    name: { type: GraphQLString },
    email: { type: GraphQLString },
  },
});

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      users: {
        type: new GraphQLList(UserType),
        resolve: (_root, _args, ctx: { requestId: string }) => {
          console.log(`[${ctx.requestId}] Resolving users`);
          return users;
        },
      },
      user: {
        type: UserType,
        args: { id: { type: new GraphQLNonNull(GraphQLID) } },
        resolve: (_root, { id }: { id: string }) =>
          users.find((u) => u.id === id) ?? null,
      },
    },
  }),
});

// ─── Axiomify App ─────────────────────────────────────────────────────────────

const app = new Axiomify();

// REST route alongside GraphQL — both live on the same server
app.route({
  method: 'GET',
  path: '/api/health',
  handler: async (_req, res) => {
    res.status(200).send({ status: 'ok', uptime: process.uptime() });
  },
});

// REST route — create a user (REST write, GraphQL read is a common pattern)
app.route({
  method: 'POST',
  path: '/api/users',
  schema: {
    body: z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  },
  handler: async (req, res) => {
    const newUser: User = {
      id: String(users.length + 1),
      name: req.body.name,
      email: req.body.email,
    };
    users.push(newUser);
    res.status(201).send(newUser, 'User created');
  },
});

// Mount the GraphQL endpoint
useGraphQL(app, {
  schema,

  // Per-request context — available as the third argument in every resolver
  context: (req) => ({
    requestId: req.id,
  }),

  // Protect against abusive queries
  maxDepth: 8,
  maxAliases: 10,

  // GraphiQL playground available at /graphql/playground
  playground: true,
});

// ─── Start ────────────────────────────────────────────────────────────────────

const adapter = new ExpressAdapter(app);
adapter.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
  console.log('');
  console.log('REST endpoints:');
  console.log('  GET  http://localhost:3000/api/health');
  console.log('  POST http://localhost:3000/api/users');
  console.log('');
  console.log('GraphQL:');
  console.log('  POST http://localhost:3000/graphql');
  console.log('  GET  http://localhost:3000/graphql/playground');
  console.log('');
  console.log('Try it:');
  console.log(`  curl -X POST http://localhost:3000/graphql \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"query":"{ users { id name email } }"}'`);
});
