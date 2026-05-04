// Axiomify Native (uWebSockets.js)
// Serves all 3 native benchmark scenarios on a single port:
//   GET  /ping
//   POST /echo              (JSON body parse + echo)
//   GET  /users/:id/posts/:postId  (two named params)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Axiomify } = require('../../packages/core/dist/index.js');
const { NativeAdapter } = require('../../packages/native/dist/index.js');

const port = parseInt(process.argv[2] || '3120', 10);

const app = new Axiomify();

// Scenario 1: GET /ping — bare JSON response
app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => {
    res.send({ pong: true });
  },
});

// Scenario 2: POST /echo — parse JSON body and echo it back
app.route({
  method: 'POST',
  path: '/echo',
  handler: async (req, res) => {
    res.send(req.body);
  },
});

// Scenario 3: GET /users/:id/posts/:postId — two named params extracted from URL
app.route({
  method: 'GET',
  path: '/users/:id/posts/:postId',
  handler: async (req, res) => {
    res.send({ id: req.params.id, postId: req.params.postId });
  },
});

const adapter = new NativeAdapter(app, { port, trustProxy: false });

adapter.listen(() => {
  process.stdout.write('READY\n');
});

process.on('SIGTERM', () => {
  adapter.close();
  process.exit(0);
});
