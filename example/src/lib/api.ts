
import { createClient } from 'axiomify/client';
import { routeMap, type AppRouter } from '../axiomify';

export const api = createClient<AppRouter>(
  {
    baseUrl: 'http://localhost:4000',
    
    interceptors: {
        
      onRequest: (req) => {
        // Automatically attach Bearer tokens to every single request globally!
        const token = localStorage.getItem('token');
        if (token) {
          req.headers = { ...req.headers, Authorization: `Bearer ${token}` };
        }
        return req;
      },
    },
  },
  routeMap,
);

