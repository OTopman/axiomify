import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { registry } from "../core/registry";

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
      plugins = [],
    } = route.config;

    // Fastify uses a different path parameter syntax than Express in some cases,
    // but standard :id syntax is supported out of the box by path-to-regexp in Fastify.

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
              .send({ error: "Validation Error", details: error.errors });
            return reply;
          }
          throw error;
        }
      },
      // Phase 2: Execution & Output Validation
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        try {
          let injectedContext = {};

          // 1. Sequentially execute plugins and merge their returned data
          if (route.config.plugins && route.config.plugins.length > 0) {
            for (const plugin of route.config.plugins) {
              const result = await plugin(req);
              if (result && typeof result === "object") {
                injectedContext = { ...injectedContext, ...result };
              }
            }
          }

          // 2. Execute the developer's business logic with the combined context
          const result = await handler({
            params: req.params,
            query: req.query,
            body: req.body,
            headers: req.headers as Record<
              string,
              string | string[] | undefined
            >,
            ...injectedContext, // Inject plugin data
          });

          const validatedResponse = await response.parseAsync(result);
          return reply.send(validatedResponse);
        } catch (error) {
          if (error instanceof z.ZodError) {
            console.error(
              `[axiomify] Response breached API contract for ${method} ${path}:`,
              error.errors,
            );
            reply.status(500).send({
              error: "Internal Server Error: Response validation failed.",
            });
            return reply;
          }
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
