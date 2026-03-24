import { route, z } from 'axiomify';
import { requireAuth } from '../../plugin/auth.js';

export default route({
  method: 'POST',
  path: '/users',
  plugins: [requireAuth],
  request: {
    body: z.object({
      email: z.string().email(),
      name: z.string().min(2),
    }),
  },
  response: z.object({
    success: z.boolean(),
    userId: z.string(),
    createdBy: z.string(),
  }),
  handler: async ({ body, user }) => {
    // `body` is strictly typed based on request.body
    // `user` is strictly typed based on the requireAuth plugin
    console.log(`Creating user ${body.name} for ${body.email}`);
    console.log(`Action performed by admin: ${user.id}`);

    return {
      success: true,
      userId: `new_${Date.now()}`,
      createdBy: user.id,
    };
  },
});
