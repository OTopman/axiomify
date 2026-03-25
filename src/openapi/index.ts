import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
import pkg from '../../package.json';
import { registry } from '../core/registry';
import type { AxiomifyConfig, Schema } from '../core/types';
import z from 'zod';

function convertToOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

// Accept the config as an optional parameter
export function generateOpenApiDocument(
  config?: AxiomifyConfig,
): OpenAPIObject {
  const openApiRegistry = new OpenAPIRegistry();
  const routes = registry.getAllRoutes();

  for (const route of routes) {
    const { method, path, request, response } = route.config;

    openApiRegistry.registerPath({
      method: method.toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'delete'
        | 'patch',
      path: convertToOpenApiPath(path),
      tags: [route.tag],
      summary: `${method} ${path}`,
      request: request
        ? {
            params: request.params as z.ZodType<unknown> | undefined,
            query: request.query as z.ZodType<unknown> | undefined,
            headers: request.headers as Schema<unknown> | undefined,
            body: request.body
              ? {
                  content: {
                    'application/json': {
                      schema: request.body as z.ZodType<unknown>,
                    },
                  },
                }
              : undefined,
          }
        : undefined,
      responses: {
        200: {
          description: 'Successful response',
          content: {
            'application/json': { schema: response },
          },
        },
      },
    });
  }

  const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: config?.openapi?.version || pkg.version,
      title: config?.openapi?.title || 'Axiomify API',
      description:
        config?.openapi?.description || 'Auto-generated API documentation',
    },
  });
}
