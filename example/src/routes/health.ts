import { route, z } from 'axiomify';

export default route({ 
  method: 'GET',
  path: '/health',
  response: z.object({
    status: z.string(),
    engine: z.string(),
    uptime: z.number(),
  }),
  handler: async () => {
    return {
      status: 'OK',
      engine: 'Axiomify',
      uptime: process.uptime(),
    };
  },
});
