import { Axiomify } from '@axiomify/core';
import { startNativeAdapter } from '@axiomify/native';

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/fast',
  handler: async (req, res) => {
    res.send({ user: 'Test', ok: true });
  },
});

startNativeAdapter(app, { port: 3000 });
