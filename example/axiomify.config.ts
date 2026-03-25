import { defineConfig } from 'axiomify';

export default defineConfig({
  server: 'express', // Change to 'fastify' to instantly swap the underlying engine
  port: 4000,
  routesDir: 'src/routes',
  openapi: {
    title: 'Axiomify Example',
    version: '1.0.0',
  },
});
