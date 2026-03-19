import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import pkg from "../../package.json";
import { registry } from "../core/registry";
import type { OpenAPIObject } from "openapi3-ts/oas30";

/**
 * Converts Express-style path parameters to OpenAPI-style.
 * Example: '/users/:id' -> '/users/{id}'
 */
function convertToOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
}

/**
 * Generates the complete OpenAPI 3.0 document from the registered routes.
 */
export function generateOpenApiDocument(): OpenAPIObject {
  const openApiRegistry = new OpenAPIRegistry();
  const routes = registry.getAllRoutes();

  for (const route of routes) {
    const { method, path, request, response } = route.config;

    openApiRegistry.registerPath({
      method: method.toLowerCase() as any,
      path: convertToOpenApiPath(path),
      tags: [route.tag],
      summary: `${method} ${path}`,
      request: request
        ? {
            params: request.params,
            query: request.query,
            headers: request.headers,
            body: request.body
              ? {
                  content: {
                    "application/json": { schema: request.body },
                  },
                }
              : undefined,
          }
        : undefined,
      responses: {
        200: {
          description: "Successful response",
          content: {
            "application/json": { schema: response },
          },
        },
      },
    });
  }

  const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: pkg.version,
      title: "Axiomify API",
      description: "Auto-generated API documentation",
    },
  });
}
