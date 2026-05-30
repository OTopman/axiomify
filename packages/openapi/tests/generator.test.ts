import { Axiomify } from '@axiomify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenApiGenerator } from '../src/generator';

describe('OpenApiGenerator', () => {
  const mockOptions = {
    info: { title: 'Test API', version: '1.0.0' },
  };

  it('wraps non-object body schema under "payload" when files are also defined', () => {
    const mockApp = {
      registeredRoutes: [
        {
          method: 'POST',
          path: '/upload',
          schema: {
            body: z.array(z.string()),
            files: { avatar: { maxSize: 1024 } as any },
          },
          handler: () => {},
        },
      ],
    } as unknown as Axiomify;

    const generator = new OpenApiGenerator(mockApp, mockOptions);
    const spec = generator.generate();
    const body = spec.paths['/upload']['post'].requestBody;
    const schema = body.content['multipart/form-data'].schema;
    expect(schema.type).toBe('object');
    expect(schema.properties.payload).toBeDefined();
    expect(schema.properties.avatar).toBeDefined();
  });

  it('falls back to {type:"object"} when zodToJsonSchema is unavailable', () => {
    // Provide a non-Zod schema (no toJSONSchema method) so the Zod v3 fallback
    // path is exercised; zod-to-json-schema may not understand it.
    const opaqueSchema = { safeParse: () => ({ success: false }) } as any;
    const mockApp = {
      registeredRoutes: [
        {
          method: 'POST',
          path: '/opaque',
          schema: { body: opaqueSchema },
          handler: () => {},
        },
      ],
    } as unknown as Axiomify;

    const generator = new OpenApiGenerator(mockApp, mockOptions);
    expect(() => generator.generate()).not.toThrow();
  });

  it('produces a correct requestBody for a Zod Array schema', () => {
    const mockApp = {
      registeredRoutes: [
        {
          method: 'POST',
          path: '/bulk',
          schema: { body: z.array(z.object({ id: z.number() })) },
          handler: () => {},
        },
      ],
    } as unknown as Axiomify;

    const generator = new OpenApiGenerator(mockApp, {
      info: { title: 'Test', version: '1' },
    });
    const spec = generator.generate();

    const requestBody = spec.paths['/bulk']['post'].requestBody;
    expect(requestBody.content['application/json'].schema.type).toBe('array');
    expect(requestBody.content['application/json'].schema.items.type).toBe(
      'object',
    );
  });

  it('produces a correct requestBody from a Zod body schema', () => {
    const mockApp = {
      registeredRoutes: [
        {
          method: 'POST',
          path: '/items',
          schema: { body: z.object({ name: z.string() }) },
          handler: () => {},
        },
      ],
    } as unknown as Axiomify;

    const generator = new OpenApiGenerator(mockApp, mockOptions);
    const spec = generator.generate();

    const requestBody = spec.paths['/items']['post'].requestBody;
    expect(
      requestBody.content['application/json'].schema.properties.name.type,
    ).toBe('string');
  });

  it('produces path parameters from a Zod params schema', () => {
    const mockApp = {
      registeredRoutes: [
        {
          method: 'GET',
          path: '/items/:id',
          schema: { params: z.object({ id: z.string() }) },
          handler: () => {},
        },
      ],
    } as unknown as Axiomify;

    const generator = new OpenApiGenerator(mockApp, mockOptions);
    const spec = generator.generate();

    const parameters = spec.paths['/items/{id}']['get'].parameters;
    const idParam = parameters.find((p: any) => p.name === 'id');
    expect(idParam).toBeDefined();
    expect(idParam.in).toBe('path');
  });

  it('formatPath() converts :id to {id} and handles multiple params correctly', () => {
    // Access the private method via casting for testing purposes
    const generator = new OpenApiGenerator(
      { registeredRoutes: [] } as any,
      mockOptions,
    ) as any;

    expect(generator.formatPath('/users/:userId/posts/:postId')).toBe(
      '/users/{userId}/posts/{postId}',
    );
    expect(generator.formatPath('/files/:filename')).toBe('/files/{filename}');
  });
});

// ─── Zod v4 z.toJSONSchema() compatibility ───────────────────────────────────

describe('OpenApiGenerator — Zod v4 schema output', () => {
  const gen = (routes: ReturnType<typeof makeApp>['registeredRoutes']) => {
    const mockApp = { registeredRoutes: routes } as unknown as Axiomify;
    return new OpenApiGenerator(mockApp, {
      info: { title: 'Test', version: '1' },
    }).generate();
  };

  function makeApp() {
    const { Axiomify: A } = require('../../core/src/app');
    return new A() as Axiomify;
  }

  it('generates non-empty schema properties for z.object body (Zod v4)', () => {
    const routes = [
      {
        method: 'POST',
        path: '/users',
        schema: { body: z.object({ name: z.string(), age: z.number() }) },
        handler: async () => {},
      },
    ] as unknown as ReturnType<typeof makeApp>['registeredRoutes'];
    const spec = gen(routes);
    const schema = (spec.paths as any)['/users']['post'].requestBody.content[
      'application/json'
    ].schema;
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(Object.keys(schema.properties)).toContain('name');
    expect(Object.keys(schema.properties)).toContain('age');
  });

  it('generates non-empty properties for path params (Zod v4)', () => {
    const routes = [
      {
        method: 'GET',
        path: '/users/:id',
        schema: { params: z.object({ id: z.string().uuid() }) },
        handler: async () => {},
      },
    ] as unknown as ReturnType<typeof makeApp>['registeredRoutes'];
    const spec = gen(routes);
    const params = (spec.paths as any)['/users/{id}']['get']
      .parameters as Array<{ name: string; in: string; required: boolean }>;
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('id');
    expect(params[0].in).toBe('path');
    expect(params[0].required).toBe(true);
  });

  it('generates query parameters with correct required flag (Zod v4)', () => {
    const routes = [
      {
        method: 'GET',
        path: '/search',
        schema: {
          query: z.object({ q: z.string(), page: z.number().optional() }),
        },
        handler: async () => {},
      },
    ] as unknown as ReturnType<typeof makeApp>['registeredRoutes'];
    const spec = gen(routes);
    const params = (spec.paths as any)['/search']['get'].parameters as Array<{
      name: string;
      required: boolean;
    }>;
    const q = params.find((p) => p.name === 'q');
    const page = params.find((p) => p.name === 'page');
    expect(q?.required).toBe(true);
    expect(page?.required).toBe(false);
  });

  it('generates 200 response schema from z.object response (Zod v4)', () => {
    const routes = [
      {
        method: 'GET',
        path: '/me',
        schema: { response: z.object({ id: z.string(), name: z.string() }) },
        handler: async () => {},
      },
    ] as unknown as ReturnType<typeof makeApp>['registeredRoutes'];
    const spec = gen(routes);
    const resp200 = (spec.paths as any)['/me']['get'].responses['200'];
    expect(resp200).toBeDefined();
    const schema = resp200.content['application/json'].schema;
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
  });

  it('generates security schemes from options.components and route security', () => {
    const routes = [
      {
        method: 'GET',
        path: '/protected',
        schema: { security: [{ bearerAuth: [] }] },
        handler: async () => {},
      },
    ] as unknown as ReturnType<typeof makeApp>['registeredRoutes'];
    const mockApp = { registeredRoutes: routes } as unknown as Axiomify;
    const spec = new OpenApiGenerator(mockApp, {
      info: { title: 'Test', version: '1' },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      },
      security: [{ bearerAuth: [] }],
    }).generate();
    expect((spec.components as any)?.securitySchemes?.bearerAuth).toBeDefined();
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    const operation = (spec.paths as any)['/protected']['get'];
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  });

  it('formatPath converts Axiomify :param syntax to OpenAPI {param} syntax', () => {
    const mockApp = { registeredRoutes: [] } as unknown as Axiomify;
    const generator = new OpenApiGenerator(mockApp, {
      info: { title: 'T', version: '1' },
    });
    expect(generator.formatPath('/users/:id/posts/:postId')).toBe(
      '/users/{id}/posts/{postId}',
    );
    expect(generator.formatPath('/plain')).toBe('/plain');
    expect(generator.formatPath('/')).toBe('/');
  });
});

describe('OpenApiGenerator — extended coverage', () => {
  it('generates per-status-code response schema when response is a map', () => {
    const ext = { url: 'https://docs.example.com', description: 'Full docs' };
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/users',
      schema: {
        response: {
          201: z.object({ id: z.string() }),
          400: z.object({ message: z.string() }),
        } as any,
        operationId: 'createUser',
        deprecated: true,
        externalDocs: ext,
        security: [],
        requestBodyDescription: 'Profile data for the new user',
      },
      handler: async (_r, res) => res.send({ id: '1' }),
    });

    const gen = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    });
    const spec = gen.generate();
    expect(spec.paths['/users']?.post?.responses?.['201']).toBeDefined();
    expect(spec.paths['/users']?.post?.responses?.['400']).toBeDefined();
  });

  it('generates path parameter schema from route.schema.params', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/users/:id',
      schema: { params: z.object({ id: z.string().uuid() }) },
      handler: async (_r, res) => res.send({ id: '1' }),
    });

    const gen = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    });
    const spec = gen.generate();
    const params = spec.paths['/users/{id}']?.get?.parameters ?? [];
    expect(params.some((p: any) => p.name === 'id' && p.in === 'path')).toBe(
      true,
    );
  });

  it('generates file upload schema when route.schema.files is defined', () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/upload',
      schema: {
        files: { photo: { maxSize: 1024 * 1024, accept: ['image/jpeg'] } },
      } as any,
      handler: async (_r, res) => res.send({ ok: true }),
    });

    const gen = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    });
    const spec = gen.generate();
    const requestBody = spec.paths['/upload']?.post?.requestBody;
    expect(requestBody).toBeDefined();
  });

  it('generates query parameter schemas', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/search',
      schema: {
        query: z.object({ q: z.string(), page: z.coerce.number().optional() }),
      },
      handler: async (_r, res) => res.send([]),
    });

    const gen = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    });
    const spec = gen.generate();
    const params = spec.paths['/search']?.get?.parameters ?? [];
    expect(params.some((p: any) => p.name === 'q' && p.in === 'query')).toBe(
      true,
    );
  });
});

// Operation-level metadata fields for full OpenAPI 3.1.0 Operation
// Object coverage (operationId, deprecated, externalDocs,
// requestBodyDescription, responseDescriptions).
describe('OpenApiGenerator — operation metadata', () => {
  it('emits operationId when supplied in schema', () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/users',
      schema: { operationId: 'createUser' },
      handler: async (_r, res) => res.send({}),
    });
    const gen = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    });
    expect(gen.generate().paths['/users']?.post?.operationId).toBe(
      'createUser',
    );
  });

  it('synthesises operationId from method+path when not supplied', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/users/:id/posts/:postId',
      handler: async (_r, res) => res.send({}),
    });
    const gen = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    });
    // Stable, deterministic id derived from the path so codegen output
    // doesn't drift between releases unless the route itself changes.
    expect(
      gen.generate().paths['/users/{id}/posts/{postId}']?.get?.operationId,
    ).toBe('getUsersByIdPostsByPostId');
  });

  it('emits deprecated:true only when schema.deprecated is set', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/old',
      schema: { deprecated: true },
      handler: async (_r, res) => res.send({}),
    });
    app.route({
      method: 'GET',
      path: '/new',
      handler: async (_r, res) => res.send({}),
    });
    const spec = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate();
    expect(spec.paths['/old']?.get?.deprecated).toBe(true);
    // Active routes should NOT have a deprecated key at all (omitted, not false).
    expect(spec.paths['/new']?.get).not.toHaveProperty('deprecated');
  });

  it('emits externalDocs verbatim', () => {
    const app = new Axiomify();
    const ext = { url: 'https://example.com/docs', description: 'API guide' };
    app.route({
      method: 'GET',
      path: '/x',
      schema: { externalDocs: ext },
      handler: async (_r, res) => res.send({}),
    });
    const spec = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate();
    expect(spec.paths['/x']?.get?.externalDocs).toEqual(ext);
  });

  it('emits empty security array (opt-out of global security)', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/public',
      schema: { security: [] },
      handler: async (_r, res) => res.send({}),
    });
    const spec = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
      security: [{ bearerAuth: [] }], // global
    }).generate();
    // Empty array MUST be emitted — that's how OpenAPI opts a route out of
    // the global security requirement. Omitting it inherits global, which
    // is the wrong behaviour.
    expect(spec.paths['/public']?.get?.security).toEqual([]);
  });

  it('overrides requestBody description', () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/users',
      schema: {
        body: z.object({ name: z.string() }),
        requestBodyDescription: 'Profile data for the new user',
      },
      handler: async (_r, res) => res.send({}),
    });
    const spec = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate();
    expect(spec.paths['/users']?.post?.requestBody?.description).toBe(
      'Profile data for the new user',
    );
  });

  it('overrides per-status response descriptions', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/users/:id',
      schema: {
        response: {
          200: z.object({ id: z.string(), name: z.string() }),
          404: z.object({ message: z.string() }),
        },
        responseDescriptions: {
          '200': 'User profile',
          '404': 'No user with the supplied id',
        },
      },
      handler: async (_r, res) => res.send({}),
    });
    const responses = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate().paths['/users/{id}']?.get?.responses;
    expect(responses?.['200']?.description).toBe('User profile');
    expect(responses?.['404']?.description).toBe(
      'No user with the supplied id',
    );
  });

  it('falls back to generator defaults when a status has no override', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/half',
      schema: {
        response: {
          200: z.object({ a: z.string() }),
          500: z.object({ message: z.string() }),
        },
        responseDescriptions: { '200': 'Custom 200 description' },
      },
      handler: async (_r, res) => res.send({}),
    });
    const responses = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate().paths['/half']?.get?.responses;
    expect(responses?.['200']?.description).toBe('Custom 200 description');
    // Untouched status falls back to the generator default.
    expect(responses?.['500']?.description).toBe('Response 500');
  });

  it('emits per-operation servers (OAS §4.7.10.11)', () => {
    const app = new Axiomify();
    const servers = [
      { url: 'https://cdn.example.com', description: 'CDN edge' },
      { url: 'https://api.example.com' },
    ];
    app.route({
      method: 'PUT',
      path: '/assets/:id',
      schema: { servers },
      handler: async (_r, res) => res.send({}),
    });
    const spec = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate();
    expect(spec.paths['/assets/{id}']?.put?.servers).toEqual(servers);
  });

  it('emits async callbacks verbatim (OAS §4.7.10.8)', () => {
    const app = new Axiomify();
    // Spec example: a webhook the server fires when a job completes.
    // The callback expression is the OUTER key; its value is a Path Item.
    const callbacks = {
      jobComplete: {
        '{$request.body#/callbackUrl}': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '200': { description: 'callback acknowledged' } },
          },
        },
      },
    };
    app.route({
      method: 'POST',
      path: '/jobs',
      schema: { callbacks },
      handler: async (_r, res) => res.send({}),
    });
    const spec = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate();
    // Pass-through: framework does NOT validate or transform the callback
    // body — it's the user's responsibility to match the spec shape.
    expect(spec.paths['/jobs']?.post?.callbacks).toEqual(callbacks);
  });
});

// In 6.0 the `meta:` field on a route definition was removed entirely.
// The generator no longer reads it; routes still carrying `meta:` from
// a 4.x codebase produce no OpenAPI metadata. `axiomify check` flags
// this as a hard FAIL so users discover it at migration time rather
// than silently losing their docs surface.
describe('OpenApiGenerator — `meta:` field removed in 6.0', () => {
  it('does NOT read from route.meta (the field was removed in 6.0)', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/legacy',
      // Cast away the type check — `meta:` is no longer in the public
      // RouteDefinition shape, but we want to prove the generator
      // ignores it if user code still has it during migration.
      ...({ meta: { tags: ['Legacy'], operationId: 'legacyOp' } } as any),
      handler: async (_r, res) => res.send({}),
    });
    const op = new OpenApiGenerator(app as any, {
      info: { title: 'T', version: '1' },
    }).generate().paths['/legacy']?.get;
    // With no `openapi:` field, the generator falls back to its defaults:
    // a synthesised operationId (`getLegacy`) and no tags array.
    expect(op?.tags).toBeUndefined();
    expect(op?.operationId).toBe('getLegacy');
  });
});
