import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';

const app = new Axiomify();
app.route({
  method: 'GET',
  path: '/bench',
  handler: async (req, res) => res.send({ hello: 'world' })
});

const server = new HttpAdapter(app).listen(3000, () => {
  console.log('Benchmark server listening on port 3000');
});
