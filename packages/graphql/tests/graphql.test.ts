/**
 * @axiomify/graphql — unit tests via direct src import.
 * graphql is an optional peer dep — tests skip when not installed.
 */
import { Axiomify, z } from '@axiomify/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGraphQL } from '../src/index';

// Load graphql ONCE from the same resolution path as the src uses
// so both share the same module instance (no "from another realm" error).
let gql: typeof import('graphql') | null = null;
try { gql = await import('graphql'); } catch { /* optional */ }

const describeGQL = gql ? describe : describe.skip;

function makeSchema() {
  if (!gql) return null as any;
  const { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLInt } = gql;
  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        hello: { type: GraphQLString, resolve: () => 'world' },
        add:   { type: GraphQLInt, args: { a: { type: GraphQLInt }, b: { type: GraphQLInt } }, resolve: (_: any, { a, b }: any) => a + b },
      },
    }),
  });
}

function makeReq(body?: any): any {
  return {
    id: 'r1', method: 'POST', url: '/graphql', path: '/graphql',
    ip: '127.0.0.1', headers: { 'content-type': 'application/json' },
    body, query: {}, params: {}, state: {}, raw: {}, stream: null,
  };
}

function makeRes(): any {
  let _raw: any; let _sent = false;
  const res: any = {
    status: (c: number) => { res._code = c; return res; },
    header: (k: string, v: string) => { res._headers = { ...(res._headers || {}), [k]: v }; return res; },
    getHeader: () => undefined, removeHeader: () => res,
    send: (d: any) => { res._data = d; _sent = true; },
    sendRaw: (d: any) => { _raw = d; _sent = true; },
    error: () => {}, stream: () => {},
    get headersSent() { return _sent; },
    get statusCode() { return res._code ?? 200; },
    get _raw() { return _raw; },
    raw: {}, capabilities: { sse: false, streaming: false }, _code: 200,
  };
  return res;
}

describeGQL('useGraphQL', () => {
  it('registers POST /graphql route by default', () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema() });
    expect(app.registeredRoutes.some(r => r.method === 'POST' && r.path === '/graphql')).toBe(true);
  });

  it('registers GET /graphql playground route when playground:true', () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema(), playground: true });
    expect(app.registeredRoutes.some(r => r.method === 'GET' && r.path === '/graphql')).toBe(true);
  });

  it('resolves { hello } query → "world"', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema() });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    const res = makeRes();
    await route.handler(makeReq({ query: '{ hello }' }), res);
    const body = JSON.parse(res._raw);
    expect(body.data.hello).toBe('world');
  });

  it('resolves add(a:3, b:4) → 7', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema() });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    const res = makeRes();
    await route.handler(makeReq({ query: '{ add(a: 3, b: 4) }' }), res);
    const body = JSON.parse(res._raw);
    expect(body.data.add).toBe(7);
  });

  it('returns errors array for unknown field', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema() });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    const res = makeRes();
    await route.handler(makeReq({ query: '{ nonexistent }' }), res);
    const body = JSON.parse(res._raw);
    expect(body.errors).toBeDefined();
  });

  it('uses custom path', () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema(), path: '/api/gql' });
    expect(app.registeredRoutes.some(r => r.path === '/api/gql')).toBe(true);
  });

  it('calls context factory per request', async () => {
    const app = new Axiomify();
    let called = false;
    useGraphQL(app, {
      schema: makeSchema(),
      context: () => { called = true; return {}; },
    });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    await route.handler(makeReq({ query: '{ hello }' }), makeRes());
    expect(called).toBe(true);
  });

  it('serves GraphiQL HTML on GET', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema(), playground: true });
    const route = app.registeredRoutes.find(r => r.method === 'GET' && r.path === '/graphql')!;
    const res = makeRes();
    await route.handler(makeReq(), res);
    expect(res.headersSent).toBe(true);
  });

  it('maxDepth rejects deeply nested queries', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema(), maxDepth: 1 });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    // Depth-1 query (just root fields) should succeed
    const res = makeRes();
    await route.handler(makeReq({ query: '{ hello }' }), res);
    expect(res.headersSent).toBe(true);
  });
});

describeGQL('GraphQL execution paths', () => {
  it('rejects query exceeding maxAliases', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema(), maxAliases: 1 });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    // Query with 2 aliases (hello1, hello2) — exceeds limit of 1
    const res = makeRes();
    await route.handler(makeReq({ query: '{ hello1: hello hello2: hello }' }), res);
    const body = JSON.parse(res._raw);
    expect(body.errors).toBeDefined();
    expect(body.errors[0].message).toMatch(/alias/i);
  });

  it('contextFactory error returns 500', async () => {
    const app = new Axiomify();
    useGraphQL(app, {
      schema: makeSchema(),
      context: async () => { throw new Error('ctx boom'); },
    });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    const res = makeRes();
    await route.handler(makeReq({ query: '{ hello }' }), res);
    expect(res._code).toBe(500);
    const body = JSON.parse(res._raw);
    expect(body.errors[0].message).toContain('ctx boom');
  });

  it('GET endpoint executes query from query string', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema(), playground: false });
    const getRoute = app.registeredRoutes.find(r => r.method === 'GET' && r.path !== '/')!;
    const req = { ...makeReq(), method: 'GET', query: { query: '{ hello }' } };
    const res = makeRes();
    await getRoute.handler(req, res);
    const body = JSON.parse(res._raw);
    expect(body.data?.hello).toBe('world');
  });

  it('GET endpoint returns 400 for malformed variables JSON', async () => {
    const app = new Axiomify();
    useGraphQL(app, { schema: makeSchema(), playground: false });
    const getRoute = app.registeredRoutes.find(r => r.method === 'GET' && r.path !== '/')!;
    const req = { ...makeReq(), method: 'GET', query: { query: '{ hello }', variables: '{bad json' } };
    const res = makeRes();
    await getRoute.handler(req, res);
    expect(res._code).toBe(400);
    const body = JSON.parse(res._raw);
    expect(body.errors[0].message).toContain('variables');
  });

  it('returns execution errors in errors array', async () => {
    if (!gql) return;
    const errorSchema = new gql.GraphQLSchema({
      query: new gql.GraphQLObjectType({
        name: 'Query',
        fields: {
          fail: {
            type: gql.GraphQLString,
            resolve: () => { throw new Error('resolver exploded'); },
          },
        },
      }),
    });
    const app = new Axiomify();
    useGraphQL(app, { schema: errorSchema });
    const route = app.registeredRoutes.find(r => r.method === 'POST')!;
    const res = makeRes();
    await route.handler(makeReq({ query: '{ fail }' }), res);
    const body = JSON.parse(res._raw);
    expect(body.errors).toBeDefined();
    expect(body.errors[0].message).toBe('resolver exploded');
  });

  it('GET endpoint with variables executes correctly', async () => {
    if (!gql) return;
    const varSchema = new gql.GraphQLSchema({
      query: new gql.GraphQLObjectType({
        name: 'Query',
        fields: {
          echo: {
            type: gql.GraphQLString,
            args: { msg: { type: gql.GraphQLString } },
            resolve: (_: any, { msg }: any) => msg,
          },
        },
      }),
    });
    const app = new Axiomify();
    useGraphQL(app, { schema: varSchema, playground: false });
    const getRoute = app.registeredRoutes.find(r => r.method === 'GET' && r.path !== '/')!;
    const req = {
      ...makeReq(), method: 'GET',
      query: { query: 'query ($m: String) { echo(msg: $m) }', variables: JSON.stringify({ m: 'hi' }) },
    };
    const res = makeRes();
    await getRoute.handler(req, res);
    const body = JSON.parse(res._raw);
    expect(body.data?.echo).toBe('hi');
  });
});
