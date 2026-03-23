import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { registry } from "../core/registry";
import { AxiomifyPlugin } from "../core/types";

/**
 * Creates and configures a Fastify instance using the registered Axiomify routes.
 */
export async function createFastifyApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }); // Developer can override logger in config later

  const routes = registry.getAllRoutes();

  for (const route of routes) {
    const {
      method,
      path,
      request,
      response,
      handler,
    } = route.config;

    // Fastify uses a different path parameter syntax than Express in some cases,
    // but standard :id syntax is supported out of the box by path-to-regexp in Fastify.
    const plugins: AxiomifyPlugin<any>[] = route.config.plugins || [];
    app.route({
      method: method,
      url: path,
      // Phase 1: Input Validation via Fastify preHandler hook
      preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
        try {
          const parsedParams = request?.params
            ? await request.params.parseAsync(req.params)
            : req.params;
          const parsedQuery = request?.query
            ? await request.query.parseAsync(req.query)
            : req.query;
          const parsedBody = request?.body
            ? await request.body.parseAsync(req.body)
            : req.body;

          // Mutate the request with stripped, validated data
          req.params = parsedParams;
          req.query = parsedQuery;
          req.body = parsedBody;
        } catch (error) {
          if (error instanceof z.ZodError) {
            reply
              .status(400)
              .send({ error: 'Validation Error', details: error.errors });
            return reply;
          }
          throw error;
        }
      },
      // Phase 2: Execution & Output Validation
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        try {
          let injectedContext = {};

          // --- 1. LIFECYCLE: onRequest ---
          if (plugins && plugins.length > 0) {
            for (const plugin of plugins) {
              if (plugin.onRequest) {
                const result = await plugin.onRequest(req);
                if (result && typeof result === 'object') {
                  injectedContext = { ...injectedContext, ...result };
                }
              }
            }
          }

          const result = await handler({
            params: req.params,
            query: req.query,
            body: req.body,
            headers: req.headers as Record<
              string,
              string | string[] | undefined
            >,
            ...injectedContext,
          });

          // Validation
          let finalResponse = response
            ? await response.parseAsync(result)
            : result;

          // --- 2. LIFECYCLE: onResponse ---
          if (plugins && plugins.length > 0) {
            // Run onResponse hooks in reverse order (onion model)
            for (const plugin of [...plugins].reverse()) {
              if (plugin.onResponse) {
                finalResponse =
                  (await plugin.onResponse(finalResponse, req)) ||
                  finalResponse;
              }
            }
          }

          return reply.send(finalResponse);
        } catch (error) {
          // --- 3. LIFECYCLE: onError ---
          if (plugins && plugins.length > 0) {
            for (const plugin of plugins) {
              if (plugin.onError) {
                await plugin.onError(error as Error, req);
              }
            }
          }

          // Existing error handling logic...
          throw error;
        }
      },
    });
  }

  // Global Error Handler
  app.setErrorHandler((error, req, reply) => {
    console.error("[axiomify] Unhandled Exception:", error);
    reply.status(500).send({ error: "Internal Server Error" });
  });

  return app;
}
