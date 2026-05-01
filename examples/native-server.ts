import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/fast',
  handler: async (req, res) => {
    res.send({ user: 'Test', ok: true });
  },
});

new NativeAdapter(app, { port: 3000 }).listen(() => {
  console.log('Axiomify pipeline is listening on port 3000');
});
