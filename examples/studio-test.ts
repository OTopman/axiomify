import { Axiomify, z } from '@axiomify/core';

export const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/api/v1/test',
  schema: {
    query: z.object({
      queryParam: z.string().optional().describe('An optional query parameter'),
    }),
    response: z.object({
      status: z.string(),
      timestamp: z.number(),
    }),
  },
  handler: async (req, res) => {
    res.send({ status: 'ok', timestamp: Date.now() });
  },
});

app.route({
  method: 'POST',
  path: '/api/v1/submit',
  schema: {
    body: z.object({
      data: z.string(),
    }),
    response: z.object({
      success: z.boolean(),
    }),
  },
  handler: async (req, res) => {
    res.send({ success: true });
  },
});
