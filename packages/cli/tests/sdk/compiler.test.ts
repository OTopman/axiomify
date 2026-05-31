import { describe, expect, it } from 'vitest';
import { CompilerPipeline } from '../../src/sdk/compiler/pipeline';
import { IRSchema } from '../../src/sdk/ir/types';

describe('CompilerPipeline', () => {
  it('should normalize and optimize a raw IRSchema', async () => {
    // 1. Arrange
    const rawSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      securitySchemes: new Map(),
      endpoints: [
        {
          operationId: 'getUsers',
          method: 'GET',
          path: '/users',
          description: 'Fetch all users',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { kind: 'primitive', name: 'number', description: '' },
            },
          ],
          pathParams: [],
          queryParams: [],
          headerParams: [],
          requestBody: undefined,
          responses: [
            {
              statusCode: 200,
              schema: {
                kind: 'array',
                items: { kind: 'primitive', name: 'string', description: '' },
                description: '',
              },
            },
          ],
        },
      ],
    };

    // Add an unused type to test dead-code elimination (optimizer)
    rawSchema.types.set('UnusedType', {
      kind: 'object',
      name: 'UnusedType',
      fields: [
        {
          name: 'id',
          type: { kind: 'primitive', name: 'string', description: '' },
          required: true,
          description: '',
        },
      ],
      description: 'This should be removed',
    });

    const pipeline = new CompilerPipeline();

    // 2. Act
    const result = await pipeline.compile(rawSchema);

    // 3. Assert
    expect(result.hasErrors).toBe(false);
    const errors = result.diagnostics.filter(
      (d: any) => d.severity === 'error',
    );
    expect(errors).toHaveLength(0);

    const compiledSchema = result.schema;
    expect(compiledSchema.info.title).toBe('Test API');
    expect(compiledSchema.endpoints).toHaveLength(1);

    // Check normalization (e.g. valid operationId check)
    expect(compiledSchema.endpoints[0].operationId).toBe('getUsers');

    // Check optimization (UnusedType should be removed)
    expect(compiledSchema.types.has('UnusedType')).toBe(false);
  });

  it('should generate diagnostics for invalid schemas', async () => {
    const rawSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      securitySchemes: new Map(),
      endpoints: [
        {
          operationId: '', // Invalid empty operationId
          method: 'GET',
          path: '/invalid',
          description: '',
          parameters: [],
          pathParams: [],
          queryParams: [],
          headerParams: [],
          responses: [],
        },
      ],
    };

    const pipeline = new CompilerPipeline();
    const result = await pipeline.compile(rawSchema);

    expect(result.hasErrors).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toMatch(/missing an operationId/i);
  });
});
