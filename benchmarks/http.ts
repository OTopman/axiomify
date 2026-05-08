import { createServer } from 'http';

const payload = JSON.stringify({ status: 'success', code: 200 });

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3000, () => {
  console.log('Raw Node HTTP baseline listening on port 3000');
});
