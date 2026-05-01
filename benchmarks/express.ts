import express from 'express';

const app = express();

app.get('/ping', (req, res) => {
  res.json({ status: 'success', code: 200 });
});

app.listen(3000, () => {
  console.log('Express baseline listening on port 3000');
});
