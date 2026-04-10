import type { Axiomify } from '@axiomify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenApiGenerator } from '../src/generator';

describe('OpenApiGenerator', () => {
  const mockOptions = {
    info: { title: 'Test API', version: '1.0.0' },
  };

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
