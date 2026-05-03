import type { Axiomify } from '@axiomify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenApiGenerator } from '../src/generator';

describe('OpenApiGenerator', () => {
  const mockOptions = {
    info: { title: 'Test API', version: '1.0.0' },
  };

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
    return new OpenApiGenerator(mockApp, { info: { title: 'Test', version: '1' } }).generate();
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
    const schema = (spec.paths as any)['/users']['post'].requestBody.content['application/json'].schema;
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
    const params = (spec.paths as any)['/users/{id}']['get'].parameters as Array<{ name: string; in: string; required: boolean }>;
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
    const params = (spec.paths as any)['/search']['get'].parameters as Array<{ name: string; required: boolean }>;
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
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearerAuth: [] }],
    }).generate();
    expect((spec.components as any)?.securitySchemes?.bearerAuth).toBeDefined();
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    const operation = (spec.paths as any)['/protected']['get'];
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  });

  it('formatPath converts Axiomify :param syntax to OpenAPI {param} syntax', () => {
    const mockApp = { registeredRoutes: [] } as unknown as Axiomify;
    const generator = new OpenApiGenerator(mockApp, { info: { title: 'T', version: '1' } });
    expect(generator.formatPath('/users/:id/posts/:postId')).toBe('/users/{id}/posts/{postId}');
    expect(generator.formatPath('/plain')).toBe('/plain');
    expect(generator.formatPath('/')).toBe('/');
  });
});
