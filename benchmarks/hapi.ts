import Hapi from '@hapi/hapi';

const init = async () => {
  const server = Hapi.server({
    port: 3000,
    host: 'localhost',
  });

  server.route({
    method: 'GET',
    path: '/ping',
    handler: (request, h) => {
      // Hapi automatically handles JSON serialization for objects
      return { status: 'success', code: 200 };
    },
  });

  await server.start();
  console.log('Hapi baseline listening on port 3000');
};

process.on('unhandledRejection', (err) => {
  console.error(err);
  process.exit(1);
});

init();
