import { Axiomify } from '@axiomify/core';
import { createRequire } from 'node:module';
import { describe, expect, it, afterEach } from 'vitest';
const require = createRequire(import.meta.url);
const graphqlModule = (() => {
  try {
    return require('graphql') as typeof import('graphql');
  } catch {
    return null;
  }
})();
const describeGraphQL = graphqlModule ? describe : describe.skip;
const useGraphQL = graphqlModule
  ? (require('../src') as typeof import('../src')).useGraphQL
  : null;

// ─── Shared test schema ───────────────────────────────────────────────────────

const schema = graphqlModule
  ? new graphqlModule.GraphQLSchema({
      query: new graphqlModule.GraphQLObjectType({
        name: 'Query',
        fields: {
          hello: { type: graphqlModule.GraphQLString, resolve: () => 'world' },
          echo: {
            type: graphqlModule.GraphQLString,
            args: { message: { type: graphqlModule.GraphQLString } },
            resolve: (_root, { message }: { message: string }) => message,
          },
        },
      }),
  })
  : null;

// ─── Minimal in-process adapter ───────────────────────────────────────────────

type MockRes = {
  _status: number;
  _body: string;
  _contentType: string;
  _headers: Record<string, string>;
  _sent: boolean;
};

function makeReqRes(
  method: 'GET' | 'POST',
  path: string,
  body: unknown = {},
  query: Record<string, string> = {},
): { req: any; res: any; mock: MockRes } {
  const mock: MockRes = {
    _status: 200,
    _body: '',
    _contentType: '',
    _headers: {},
    _sent: false,
  };

  const res: any = {
    get headersSent() {
      return mock._sent;
    },
    get statusCode() {
      return mock._status;
    },
    status(code: number) {
      mock._status = code;
      return res;
    },
    header(k: string, v: string) {
      mock._headers[k] = v;
      return res;
    },
    removeHeader(k: string) {
      delete mock._headers[k];
      return res;
    },
    send(data: unknown) {
      mock._body = JSON.stringify(data);
      mock._sent = true;
    },
    sendRaw(payload: string, contentType?: string) {
      mock._body = payload;
      mock._contentType = contentType ?? '';
      mock._sent = true;
    },
    error(err: unknown) {
      mock._body = String(err);
      mock._sent = true;
    },
    stream() {},
    sseInit() {},
    sseSend() {},
  };

  const req: any = {
    id: 'test-id',
    method,
    url: path,
    path,
    ip: '127.0.0.1',
    headers: { 'content-type': 'application/json' },
    body,
    query,
    params: {},
    state: {},
    raw: null,
    stream: null,
  };

  return { req, res, mock };
}

async function invoke(
  app: Axiomify,
  method: 'GET' | 'POST',
  path: string,
  body: unknown = {},
  query: Record<string, string> = {},
): Promise<MockRes> {
  const { req, res, mock } = makeReqRes(method, path, body, query);
  await app.handle(req, res);
  return mock;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describeGraphQL('@axiomify/graphql — useGraphQL()', () => {
  it('executes a simple POST query', async () => {
    if (!schema) return;
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(app, 'POST', '/graphql', { query: '{ hello }' });

    expect(r._status).toBe(200);
    expect(JSON.parse(r._body).data).toEqual({ hello: 'world' });
  });

  it('passes variables to the resolver', async () => {
    if (!schema) return;
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(app, 'POST', '/graphql', {
      query: 'query Echo($msg: String) { echo(message: $msg) }',
      variables: { msg: 'axiomify' },
    });

    expect(r._status).toBe(200);
    expect(JSON.parse(r._body).data).toEqual({ echo: 'axiomify' });
  });

  it('returns 400 when the query field is missing', async () => {
    if (!schema) return;
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(app, 'POST', '/graphql', {});
    expect(r._status).toBe(400);
    expect(JSON.parse(r._body).errors[0].message).toMatch(/missing "query"/i);
  });

  it('returns 400 for parse errors', async () => {
    if (!schema) return;
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(app, 'POST', '/graphql', { query: '{ !!invalid' });
    expect(r._status).toBe(400);
    expect(JSON.parse(r._body).errors).toHaveLength(1);
  });

  it('returns 400 for validation errors (unknown field)', async () => {
    if (!schema) return;
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(app, 'POST', '/graphql', {
      query: '{ doesNotExist }',
    });
    expect(r._status).toBe(400);
    expect(JSON.parse(r._body).errors.length).toBeGreaterThan(0);
  });

  it('enforces maxDepth', async () => {
    const deepSchema = graphqlModule!.buildSchema(`
      type Query { a: A }
      type A { b: B }
      type B { value: String }
    `);
    const app = new Axiomify();
    useGraphQL(app, { schema: deepSchema, maxDepth: 2, playground: false });

    const r = await invoke(app, 'POST', '/graphql', {
      query: '{ a { b { value } } }',
    });
    expect(r._status).toBe(400);
    expect(JSON.parse(r._body).errors[0].message).toMatch(/depth/i);
  });

  it('allows queries within maxDepth', async () => {
    const deepSchema = graphqlModule!.buildSchema(`
      type Query { a: A }
      type A { b: B }
      type B { value: String }
    `);
    const app = new Axiomify();
    useGraphQL(app, { schema: deepSchema, maxDepth: 4, playground: false });

    const r = await invoke(app, 'POST', '/graphql', {
      query: '{ a { b { value } } }',
    });
    expect(r._status).toBe(200);
  });

  it('enforces maxAliases', async () => {
    if (!schema) return;
    const app = new Axiomify();
    useGraphQL(app, { schema, maxAliases: 1, playground: false });

    const r = await invoke(app, 'POST', '/graphql', {
      query: '{ a: hello b: hello }',
    });
    expect(r._status).toBe(400);
    expect(JSON.parse(r._body).errors[0].message).toMatch(/alias/i);
  });

  it('handles GET queries via query string', async () => {
    if (!schema) return;
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(app, 'GET', '/graphql', {}, { query: '{ hello }' });
    expect(r._status).toBe(200);
    expect(JSON.parse(r._body).data).toEqual({ hello: 'world' });
  });

  it('returns 405 with Allow: POST header when a mutation is attempted over GET', async () => {
    const mutSchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: { ping: { type: GraphQLString, resolve: () => 'pong' } },
      }),
      mutation: new GraphQLObjectType({
        name: 'Mutation',
        fields: {
          setName: { type: GraphQLString, resolve: () => 'done' },
        },
      }),
    });

    const app = new Axiomify();
    useGraphQL(app, { schema: mutSchema, playground: false });

    const r = await invoke(
      app,
      'GET',
      '/graphql',
      {},
      { query: 'mutation { setName }' },
    );

    expect(r._status).toBe(405);
    expect(r._headers['Allow']).toBe('POST');
  });

  it('returns 400 for invalid variables JSON in GET', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(
      app,
      'GET',
      '/graphql',
      {},
      {
        query: '{ hello }',
        variables: '{not json}',
      },
    );

    expect(r._status).toBe(400);
    expect(JSON.parse(r._body).errors[0].message).toMatch(/variables/i);
  });

  it('registers the playground route when enabled', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: true });

    const r = await invoke(app, 'GET', '/graphql/playground');
    expect(r._status).toBe(200);
    expect(r._contentType).toBe('text/html');
    expect(r._body).toContain('GraphiQL');
  });

  it('does NOT register the playground route when disabled', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema, playground: false });

    const r = await invoke(app, 'GET', '/graphql/playground');
    expect(r._status).toBe(404);
  });

  it('respects a custom endpoint path', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema, path: '/api/gql', playground: false });

    const r = await invoke(app, 'POST', '/api/gql', { query: '{ hello }' });
    expect(r._status).toBe(200);
    expect(JSON.parse(r._body).data).toEqual({ hello: 'world' });
  });

  it('injects context into resolvers', async () => {
    const ctxSchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          userId: {
            type: GraphQLString,
            resolve: (_root, _args, ctx: any) => ctx.userId,
          },
        },
      }),
    });

    const app = new Axiomify();
    useGraphQL(app, {
      schema: ctxSchema,
      playground: false,
      context: (req) => ({
        userId: (req.headers as any)['x-user-id'] ?? 'anonymous',
      }),
    });

    const { req, res, mock } = makeReqRes('POST', '/graphql', {
      query: '{ userId }',
    });
    req.headers['x-user-id'] = 'u-42';
    await app.handle(req, res);

    expect(mock._status).toBe(200);
    expect(JSON.parse(mock._body).data).toEqual({ userId: 'u-42' });
  });

  it('always returns 200 with partial errors on resolver throw', async () => {
    const errSchema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          boom: {
            type: GraphQLString,
            resolve: () => {
              throw new Error('resolver exploded');
            },
          },
        },
      }),
    });

    const app = new Axiomify();
    useGraphQL(app, { schema: errSchema, playground: false });

    const r = await invoke(app, 'POST', '/graphql', { query: '{ boom }' });
    expect(r._status).toBe(200);
    const body = JSON.parse(r._body);
    expect(body.errors).toBeDefined();
    expect(body.errors[0].message).toMatch(/resolver exploded/i);
  });

  describe('disableIntrospection', () => {
    const savedEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = savedEnv;
    });

    it('disables introspection when NODE_ENV=production and option is not set', async () => {
      process.env.NODE_ENV = 'production';
      const app = new Axiomify();
      useGraphQL(app, { schema, playground: false });

      const r = await invoke(app, 'POST', '/graphql', {
        query: '{ __schema { types { name } } }',
      });
      expect(r._status).toBe(400);
      expect(JSON.parse(r._body).errors[0].message).toMatch(/introspection/i);
    });

    it('allows introspection in development when option is not set', async () => {
      process.env.NODE_ENV = 'development';
      const app = new Axiomify();
      useGraphQL(app, { schema, playground: false });

      const r = await invoke(app, 'POST', '/graphql', {
        query: '{ __schema { queryType { name } } }',
      });
      expect(r._status).toBe(200);
    });

    it('explicit disableIntrospection: true overrides development environment', async () => {
      process.env.NODE_ENV = 'development';
      const app = new Axiomify();
      useGraphQL(app, {
        schema,
        playground: false,
        disableIntrospection: true,
      });

      const r = await invoke(app, 'POST', '/graphql', {
        query: '{ __schema { queryType { name } } }',
      });
      expect(r._status).toBe(400);
    });

    it('explicit disableIntrospection: false overrides production environment', async () => {
      process.env.NODE_ENV = 'production';
      const app = new Axiomify();
      useGraphQL(app, {
        schema,
        playground: false,
        disableIntrospection: false,
      });

      const r = await invoke(app, 'POST', '/graphql', {
        query: '{ __schema { queryType { name } } }',
      });
      expect(r._status).toBe(200);
    });
  });
});
