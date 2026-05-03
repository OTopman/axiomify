// Bare Express 4 — no Axiomify
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const express = require('express');

const port = parseInt(process.argv[2] || '3101', 10);
const app = express();

app.get('/ping', (_req, res) => {
  res.json({ status: 'success', data: { pong: true } });
});

const server = app.listen(port, () => {
  process.stdout.write('READY\n');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
