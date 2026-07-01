# @axiomify/graphql

[![npm version](https://img.shields.io/npm/v/@axiomify/graphql.svg)](https://npmjs.com/package/@axiomify/graphql)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Drop-in GraphQL endpoint for Axiomify with a built-in GraphiQL playground, per-request context, and abuse-prevention controls.

## Install

```bash
npm install @axiomify/graphql graphql
```

`graphql` is a peer dependency — install a `^16.0.0` version alongside this package.

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { buildSchema } from 'graphql';
import { useGraphQL } from '@axiomify/graphql';

const app = new Axiomify();

const schema = buildSchema(`
  type Query {
    hello: String
  }
`);

useGraphQL(app, { schema });

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => {
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

Defaults marked "prod / dev" differ by environment: the production value applies when `NODE_ENV === 'production'`, otherwise the development value is used.

| Option                 | Type                     | Default                       | Description                                                              |
| :--------------------- | :----------------------- | :---------------------------- | :----------------------------------------------------------------------- |
| `schema`               | `GraphQLSchema`          | **required**                  | The compiled GraphQL schema to execute against.                          |
| `path`                 | `string`                 | `'/graphql'`                  | HTTP path for the POST/GET endpoint.                                     |
| `playground`           | `boolean`                | `false` (prod) / `true` (dev) | Enable the GraphiQL browser UI.                                          |
| `playgroundPath`       | `string`                 | `'{path}/playground'`         | Path for the GraphiQL page.                                              |
| `context`              | `(req, res) => TContext` | `{}`                          | Per-request context factory. Can be async.                               |
| `maxDepth`             | `number`                 | `12` (prod) / none (dev)      | Reject queries deeper than this many levels.                             |
| `maxAliases`           | `number`                 | `15` (prod) / none (dev)      | Reject queries with more aliases than this limit.                        |
| `maxFields`            | `number`                 | `100` (prod) / none (dev)     | Reject queries with more fields than this limit (wide-query protection). |
| `maxQueryLength`       | `number`                 | `10000`                       | Reject a raw query string longer than this many characters (pre-parse).  |
| `maxVariablesLength`   | `number`                 | `10000`                       | Reject serialized variables JSON longer than this many characters.       |
| `disableIntrospection` | `boolean`                | `true` (prod) / `false` (dev) | Block introspection queries (`__schema`, `__type`).                      |
| `validationRules`      | `array`                  | `[]`                          | Additional GraphQL validation rules beyond the spec defaults.            |

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

## Query Limits & Abuse Prevention

Without limits, a malicious client can craft deeply nested, heavily aliased, or
wide queries that are cheap to send but expensive to resolve.

```typescript
useGraphQL(app, {
  schema,
  maxDepth: 8, // rejects: { a { b { c { d { e { f { g { h { value } } } } } } } } }
  maxAliases: 15, // rejects: { a1: field a2: field ... a16: field }
  maxFields: 100, // rejects queries selecting more than 100 fields total
});
```

`maxDepth`, `maxAliases`, and `maxFields` are enforced as validation rules, so
they run alongside the standard GraphQL spec rules with no separate schema pass.
In production (`NODE_ENV === 'production'`) they default to `12`, `15`, and
`100` respectively; in development they are disabled unless set explicitly.

### Raw input size limits

Two length checks run **before** the query is parsed, so an oversized payload
can never reach the parser (CWE-400):

- `maxQueryLength` (default `10000`) — rejects a raw query string longer than
  this many characters with HTTP 400.
- `maxVariablesLength` (default `10000`) — rejects serialized variables JSON
  longer than this many characters with HTTP 400.

```typescript
useGraphQL(app, {
  schema,
  maxQueryLength: 20000,
  maxVariablesLength: 5000,
});
```

## Introspection

Introspection (`__schema`, `__type`) is disabled by default in production and
enabled in development. It exposes your full schema to any client, so keep it
off in production unless you have a reason to expose it:

```typescript
useGraphQL(app, {
  schema,
  disableIntrospection: true, // force-off regardless of NODE_ENV
});
```

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
import { NativeAdapter } from '@axiomify/native';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import { useGraphQL } from '@axiomify/graphql';

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

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => console.log('Ready'));
```
