# @axiomify/graphql

Drop-in GraphQL endpoint for Axiomify with a built-in GraphiQL playground, per-request context, and abuse-prevention controls.

## Install

```bash
npm install @axiomify/graphql graphql
```

`graphql` is a peer dependency — install a `^16.0.0` version alongside this package.

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';
import { buildSchema } from 'graphql';
import { useGraphQL } from '@axiomify/graphql';

const app = new Axiomify();

const schema = buildSchema(`
  type Query {
    hello: String
  }
`);

useGraphQL(app, { schema });

const adapter = new HttpAdapter(app);
adapter.listen(3000, () => {
  console.log('GraphQL ready at http://localhost:3000/graphql');
  console.log('Playground at   http://localhost:3000/graphql/playground');
});
```

## Exports

- `useGraphQL(app, options)` — mounts the GraphQL endpoint
- `GraphQLPluginOptions` — full options interface
- `GraphQLContextFactory` — type for the context factory function
- `GraphQLResult` — shape of every GraphQL response

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `schema` | `GraphQLSchema` | **required** | The compiled GraphQL schema to execute against. |
| `path` | `string` | `'/graphql'` | HTTP path for the POST/GET endpoint. |
| `playground` | `boolean` | `true` | Enable the GraphiQL browser UI. |
| `playgroundPath` | `string` | `'{path}/playground'` | Path for the GraphiQL page. |
| `context` | `(req, res) => TContext` | `{}` | Per-request context factory. Can be async. |
| `maxDepth` | `number` | none | Reject queries deeper than this many levels. |
| `maxAliases` | `number` | none | Reject queries with more aliases than this limit. |
| `validationRules` | `array` | `[]` | Additional GraphQL validation rules beyond the spec defaults. |

## Endpoints

Three routes are registered automatically:

### `POST /graphql`

The primary query endpoint. Accepts a JSON body:

```json
{
  "query": "query GetUser($id: ID!) { user(id: $id) { name } }",
  "variables": { "id": "42" },
  "operationName": "GetUser"
}
```

### `GET /graphql`

Accepts the same fields as query-string parameters. Useful for introspection tooling and simple queries:

```
GET /graphql?query={hello}
```

### `GET /graphql/playground`

Serves a self-contained GraphiQL 3 UI. Disable with `playground: false`.

## Context Factory

The `context` option receives the full `AxiomifyRequest` and `AxiomifyResponse` and can return any value. It runs once per request before the resolver tree executes.

```typescript
useGraphQL(app, {
  schema,
  context: async (req) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const user = token ? await verifyToken(token) : null;
    return { user, db };
  },
});
```

If the factory throws, the request is rejected with HTTP 500 before the schema is touched.

## Depth & Alias Limiting

Without limits, a malicious client can craft deeply nested or heavily aliased queries that are cheap to send but expensive to resolve.

```typescript
useGraphQL(app, {
  schema,
  maxDepth: 8,      // rejects: { a { b { c { d { e { f { g { h { value } } } } } } } } }
  maxAliases: 15,   // rejects: { a1: field a2: field ... a16: field }
});
```

Both checks run before validation and execution, so they impose no schema overhead.

## Custom Validation Rules

Pass extra validation rules that run alongside the standard GraphQL spec rules:

```typescript
import { NoSchemaIntrospectionCustomRule } from 'graphql';

useGraphQL(app, {
  schema,
  validationRules: [NoSchemaIntrospectionCustomRule], // disable introspection in prod
});
```

## Error Handling

Per the GraphQL spec, resolver errors are returned as HTTP 200 with an `errors` array:

```json
{
  "data": { "user": null },
  "errors": [{ "message": "User not found", "path": ["user"] }]
}
```

Only malformed requests (unparseable query, failed validation, bad variables JSON) return 4xx status codes.

## Example: Full Setup

```typescript
import { Axiomify } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import { useGraphQL } from '@axiomify/graphql';

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      hello: {
        type: GraphQLString,
        resolve: (_root, _args, ctx) => `Hello, ${ctx.user?.name ?? 'stranger'}`,
      },
    },
  }),
});

const app = new Axiomify();

useGraphQL(app, {
  schema,
  path: '/graphql',
  playground: true,
  maxDepth: 10,
  maxAliases: 20,
  context: async (req) => ({
    user: await getUserFromHeader(req.headers['authorization']),
  }),
});

const adapter = new ExpressAdapter(app);
adapter.listen(3000);
```