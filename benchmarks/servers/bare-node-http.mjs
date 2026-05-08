// Bare Node.js http — no framework, no Axiomify
import http from 'http';

const port = parseInt(process.argv[2] || '3100', 10);
const PONG = Buffer.from(JSON.stringify({ status: 'success', data: { pong: true } }));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(PONG);
});

server.listen(port, () => {
  process.stdout.write('READY\n');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
