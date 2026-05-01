import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';

const app = new Axiomify();

// We use the exact same payload shape as our initial Sandbox spike
// to keep the benchmark perfectly apples-to-apples.
app.route({
  method: 'GET',
  path: '/api',
  handler: async (req, res) => {
    res.send({ status: 'success', code: 200 });
  },
});

console.log('Compiling Axiomify pipeline...');
new NativeAdapter(app, { port: 3000 }).listen();
