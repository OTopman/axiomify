/**
 * Schema Discovery — extracts Zod validation schemas from each route and
 * converts them to JSON Schema representations for display in Studio.
 *
 * Uses Zod v4's built-in `z.toJSONSchema()` when available, falling back
 * to `zod-to-json-schema` for Zod v3. Mirrors the conversion strategy
 * used by {@link OpenApiGenerator} and {@link ValidationCompiler}.
 */
import type { DiscoveredSchema } from './types';

/**
 * Attempts to convert a Zod schema to a JSON Schema representation.
 * Returns `undefined` if conversion fails (schema not present or not
 * expressible as JSON Schema).
 */
function zodToJsonSchemaSafe(schema: any): Record<string, unknown> | undefined {
  if (!schema) return undefined;

  // Zod v4 native path — toJSONSchema() is an instance method.
  if (typeof schema.toJSONSchema === 'function') {
    try {
      const full = schema.toJSONSchema({ target: 'openApi3_1' });
      const { $schema: _dropped, ...rest } = full as Record<string, unknown>;
      return rest;
    } catch {
      // Fall through to zod-to-json-schema fallback.
    }
  }

  // Zod v3 fallback via zod-to-json-schema.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { zodToJsonSchema } = require('zod-to-json-schema');
    return zodToJsonSchema(schema, { target: 'openApi3' }) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

/**
 * Checks whether a value looks like a Zod schema (duck typing).
 */
function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

/**
 * Extracts validation schemas from all registered routes and converts
 * them to JSON Schema objects for display.
 */
export function discoverSchemas(app: any): DiscoveredSchema[] {
  const result: DiscoveredSchema[] = [];

  for (const route of app.registeredRoutes ?? []) {
    const s = route.schema;
    if (!s) continue;

    const hasAnySchema =
      s.body || s.query || s.params || s.response || s.files || s.message;
    if (!hasAnySchema) continue;

    const schema: DiscoveredSchema = {
      routeId: `${route.method}:${route.path}`,
      method: route.method,
      path: route.path,
    };

    if (s.body) schema.body = zodToJsonSchemaSafe(s.body);
    if (s.query) schema.query = zodToJsonSchemaSafe(s.query);
    if (s.params) schema.params = zodToJsonSchemaSafe(s.params);

    if (s.response) {
      if (isZodSchema(s.response)) {
        schema.response = zodToJsonSchemaSafe(s.response);
      } else if (typeof s.response === 'object') {
        // Multi-status response map: Record<number, ZodTypeAny>
        const responseMap: Record<string, Record<string, unknown>> = {};
        for (const [code, zodSchema] of Object.entries(s.response)) {
          const converted = zodToJsonSchemaSafe(zodSchema);
          if (converted) responseMap[code] = converted;
        }
        if (Object.keys(responseMap).length > 0) {
          schema.response = responseMap;
        }
      }
    }

    if (s.files) {
      // Files config is not a Zod schema — pass it through as-is,
      // stripping non-serialisable fields (rename function, etc.).
      const safeFiles: Record<string, unknown> = {};
      for (const [field, config] of Object.entries(
        s.files as Record<string, any>,
      )) {
        safeFiles[field] = {
          maxSize: config.maxSize,
          accept: config.accept,
          maxFiles: config.maxFiles,
          preserveOriginalName: config.preserveOriginalName,
          validateContent: config.validateContent,
        };
      }
      schema.files = safeFiles;
    }

    result.push(schema);
  }

  // WebSocket routes.
  for (const route of app.registeredWsRoutes ?? []) {
    const s = route.schema;
    if (!s) continue;

    const hasAnySchema = s.message || s.query || s.params;
    if (!hasAnySchema) continue;

    const schema: DiscoveredSchema = {
      routeId: `WS:${route.path}`,
      method: 'WS',
      path: route.path,
    };

    if (s.message) schema.message = zodToJsonSchemaSafe(s.message);
    if (s.query) schema.query = zodToJsonSchemaSafe(s.query);
    if (s.params) schema.params = zodToJsonSchemaSafe(s.params);

    result.push(schema);
  }

  return result;
}
