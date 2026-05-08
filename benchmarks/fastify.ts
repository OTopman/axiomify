import Fastify from 'fastify';

const fastify = Fastify();

fastify.get('/ping', async (request, reply) => {
  return { status: 'success', code: 200 };
});

fastify.listen({ port: 3000 }).then(() => {
  console.log('Fastify baseline listening on port 3000');
});
