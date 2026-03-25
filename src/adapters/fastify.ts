import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { registry } from '../core/registry';
import { AxiomifyRequest } from '../core/types';
import { executePipeline } from '../runtime/pipeline';

export async function createFastifyApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const routes = registry.getAllRoutes();

  for (const route of routes) {
    const { method, path } = route.config;

    app.route({
      method: method,
      url: path,
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        try {
          const agnosticReq: AxiomifyRequest<FastifyRequest> = {
            method: req.method,
            url: req.url,
            path,
            query: (req.query || {}) as Record<string, unknown>,
            params: (req.params || {}) as Record<string, unknown>,
            headers: req.headers,
            rawBody: req.body,
            engine: 'fastify',
            originalRequest: req,
          };

          // Delegate entirely to the unified pipeline
          const result = await executePipeline(route.config, agnosticReq);
          return reply.send(result);
        } catch (error: unknown) {
          if (error instanceof Error) {
            if (error.name === 'ZodError') {
              reply.status(400).send({
                error: 'Validation Error',
                details: (error as Error & { errors: unknown }).errors,
              });
              return;
            }
            if (error.message === 'Unauthorized') {
              reply.status(401).send({ error: 'Unauthorized' });
              return;
            }
          }
          throw error;
        }
      },
    });
  }

  // Global Error Handler
  app.setErrorHandler((error, req, reply) => {
    console.error('[axiomify] Unhandled Exception:', error);
    reply.status(500).send({ error: 'Internal Server Error' });
  });

  return app;
}
