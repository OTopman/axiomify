import { route, z } from 'axiomify';

export default route({
  method: 'GET',
  path: '/v1/ping',
  // No request body/query needed
  response: z.object({
    message: z.string(),
    timestamp: z.number(),
  }),
  handler: async () => {
    return {
      message: 'Axiomify is alive!',
      timestamp: Date.now(),
    };
  },
});
