import { createClient } from 'axiomify/client';
import { AppRouter, routeMap } from '../axiomify';

// 1. Initialize the client with your backend URL
const api = createClient<AppRouter>(
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  routeMap,
);

api.users
  .create({
    body: {
      email: 'okunlolatopman14@gmail.com',
      name: 'Raphael',
    },
  })
  .then(console.log)
  .catch(console.error);
