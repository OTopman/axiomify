import { route, z } from 'axiomify';

export default route({
  method: 'GET',
  path: '/posts/:id',
  request: {
    // Uncomment and define to enforce payload validation
    // body: z.object({}),
    // query: z.object({}),
    // params: z.object({}),
  },
  response: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  handler: async (_ctx) => {
    return { success: true };
  },
}); 
