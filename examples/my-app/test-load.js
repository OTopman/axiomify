const { loadApp } = require('../../packages/cli/dist/index.js');
const path = require('path');

async function test() {
  const result = await loadApp(path.resolve(__dirname, 'src/index.ts'));
  console.log('App type:', typeof result.app);
  console.log('App constructor:', result.app.constructor.name);
  console.log('registeredRoutes exists:', 'registeredRoutes' in result.app);
  console.log('registeredRoutes type:', typeof result.app.registeredRoutes);
  console.log('Is Array?', Array.isArray(result.app.registeredRoutes));
  await result.cleanup();
}

test().catch(console.error);
