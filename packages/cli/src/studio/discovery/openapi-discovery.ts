/**
 * OpenAPI Discovery — generates the OpenAPI 3.1 specification from a
 * loaded Axiomify app instance using the {@link OpenApiGenerator} from
 * `@axiomify/openapi`.
 *
 * The OpenAPI package is dynamically imported since it's an optional
 * dependency — users who don't use OpenAPI shouldn't see errors about
 * a missing package.
 */
import type { DiscoveredOpenApiSpec } from './types';

/**
 * Attempts to generate an OpenAPI 3.1 spec from the loaded app.
 * Returns `null` if `@axiomify/openapi` is not installed or if
 * generation fails.
 */
export async function discoverOpenApi(
  app: any,
): Promise<DiscoveredOpenApiSpec | null> {
  try {
    // Dynamic import so Studio doesn't hard-require @axiomify/openapi.
    const { OpenApiGenerator } = await import('@axiomify/openapi');

    const generator = new OpenApiGenerator(app, {
      info: {
        title: 'Axiomify Studio',
        version: '1.0.0',
        description: 'Auto-generated specification for Axiomify Studio.',
      },
    });

    return generator.generate() as DiscoveredOpenApiSpec;
  } catch {
    // @axiomify/openapi not installed or generation failed.
    return null;
  }
}
