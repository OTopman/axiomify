import { describe, it, expect } from 'vitest';
import { ingestOpenApi } from '../../src/sdk/ingest/openapi';

describe('OpenAPI Ingestor', () => {
  it('should ingest a valid OpenAPI schema into an IRSchema', () => {
    const rawOpenApi = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.2.3' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            summary: 'List users',
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
      },
    };

    const result = ingestOpenApi(rawOpenApi, {});

    expect(result.diagnostics).toHaveLength(0);
    expect(result.schema.info.title).toBe('Test API');
    expect(result.schema.info.version).toBe('1.2.3');

    expect(result.schema.endpoints).toHaveLength(1);
    expect(result.schema.endpoints[0].operationId).toBe('listUsers');
    expect(result.schema.endpoints[0].method).toBe('GET');
    expect(result.schema.endpoints[0].path).toBe('/users');
  });

  it('should auto-generate operationId if missing', () => {
    const rawOpenApi = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/auto-id': {
          post: {
            responses: {
              '200': { description: 'Success' },
            },
          },
        },
      },
    };

    const result = ingestOpenApi(rawOpenApi, {});

    expect(result.schema.endpoints).toHaveLength(1);
    expect(result.schema.endpoints[0].operationId).toBe('postAuto-id');
  });
});
