import { AxiomifyPlugin } from 'axiomify';

// Simulates an authentication middleware that injects a typed user object
export const requireAuth: AxiomifyPlugin<{
  user: { id: string; role: string };
}> = {
  name: 'Authentication',

  // The onRequest hook replaces the old direct function call
  onRequest: async (req) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new Error('Unauthorized');
    }

    // In a real app, verify the token here
    return {
      user: { id: 'usr_123', role: 'admin' },
    };
  },
};
