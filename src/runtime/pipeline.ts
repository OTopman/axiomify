import { AxiomifyRequest, RouteContext, RouteDefinition } from '../core/types';

/**
 * The unified execution pipeline for Axiomify.
 * Handles validation, lifecycle hooks, and handler execution agnostically.
 */
export async function executePipeline(
  route: RouteDefinition<any, any, any, any, any>,
  agnosticReq: AxiomifyRequest,
): Promise<unknown> {
  const plugins = route.plugins || [];
  let injectedContext: Record<string, unknown> = {};

  try {
    // --- 1. LIFECYCLE: onRequest ---
    if (plugins.length > 0) {
      for (const plugin of plugins) {
        if (plugin.onRequest) {
          const result = await plugin.onRequest(agnosticReq);
          if (result && typeof result === 'object') {
            injectedContext = { ...injectedContext, ...result };
          }
        }
      }
    }

    // --- 2. Input Validation ---
    const parsedParams = route.request?.params
      ? await route.request.params.parseAsync(agnosticReq.params)
      : agnosticReq.params;

    const parsedQuery = route.request?.query
      ? await route.request.query.parseAsync(agnosticReq.query)
      : agnosticReq.query;

    const parsedBody = route.request?.body
      ? await route.request.body.parseAsync(agnosticReq.rawBody)
      : agnosticReq.rawBody;

    // --- 3. Build Handler Context ---
    const context: RouteContext<any, any, any, any> = {
      params: parsedParams,
      query: parsedQuery,
      body: parsedBody,
      headers: agnosticReq.headers,
      ...injectedContext,
    };

    // --- 4. Execute Business Logic ---
    const handlerResult = await route.handler(context);

    // --- 5. Output Validation ---
    let finalResponse = route.response
      ? await route.response.parseAsync(handlerResult)
      : handlerResult;

    // --- 6. LIFECYCLE: onResponse ---
    if (plugins.length > 0) {
      // Run hooks in reverse (Onion Model)
      for (const plugin of [...plugins].reverse()) {
        if (plugin.onResponse) {
          finalResponse =
            (await plugin.onResponse(finalResponse, agnosticReq)) ??
            finalResponse;
        }
      }
    }

    return finalResponse;
  } catch (error) {
    // --- 7. LIFECYCLE: onError ---
    if (plugins.length > 0) {
      for (const plugin of plugins) {
        if (plugin.onError) {
          await plugin.onError(error as Error, agnosticReq);
        }
      }
    }
    // Re-throw the error for the Adapter to handle HTTP status codes
    throw error;
  }
}
