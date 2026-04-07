import { Axiomify, UnauthorizedError, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { useOpenAPI } from '@axiomify/openapi';
import { useUpload } from '@axiomify/upload';
import { randomUUID } from 'crypto';
import path from 'path';

export const app = new Axiomify();

// 1. A strictly validated route
app.route({
  method: 'POST',
  path: '/api/users',
  schema: {
    body: z.object({
      username: z.string().min(3).describe('The new username'),
      role: z.enum(['admin', 'user']).default('user').describe('The user role'),
    }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: 1, ...req.body }, 'User created successfully');
  },
});
 
// 1. Enable the Upload Engine
useUpload(app);
app.route({
  method: 'POST',
  path: '/api/users/avatar',
  schema: {
    // Standard text validation runs AFTER the multipart fields are parsed!
    body: z.object({
      userId: z.string().uuid(),
    }),

    // 🚀 Declarative File Uploads
    files: {
      avatar: {
        maxSize: 5 * 1024 * 1024, // 5MB limit
        accept: ['image/png', 'image/jpeg'],
        autoSaveTo: path.join(__dirname, '../uploads'),

        // The dynamic rename hook!
        rename: (originalName, mimetype) => {
          const ext = mimetype === 'image/png' ? '.png' : '.jpg';
          return `avatar_${randomUUID()}${ext}`;
        },
      },
    },
  },
  handler: async (req, res) => {
    // At this point, the file is ALREADY saved to disk safely,
    // sized-checked, type-checked, and renamed.
    const avatarData = req.files!['avatar'];

    res.status(201).send(
      {
        fileDetails: avatarData,
      },
      'Avatar updated successfully',
    );
  },
});

// 2. Generate Swagger Docs automatically
useOpenAPI(app, {
  routePrefix: '/docs',
  info: { title: 'Axiomify Test API', version: '1.0.0' },
});

app.route({
  method: 'GET',
  path: '/api/secure-data',
  handler: async (req, res) => {
    const isAuthed = false; // logic here

    if (!isAuthed) {
      // 🚀 Just throw! The engine catches it and sends a 401 JSON automatically.
      throw new UnauthorizedError('You do not have access to this.');
    }

    res.send({});
  },
});

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (req, res) => {
    res.status(200).send({ message: 'pong' });
  },
});

if (require.main === module) {
  const adapter = new ExpressAdapter(app);
  const server = adapter.listen(3000, () => {
    console.log('🚀 Axiomify engine online on port 3000');
  });

  // Signal Handling for Production
  const shutdown = (signal: string) => {
    console.log(`\n shadowing ${signal} received. Closing Axiomify engine...`);

    // 1. Stop accepting new connections
    // 2. Wait for existing requests to finish (default node behavior)
    /* server.close(() => {
      console.log('🤝 All active requests finished. Server closed.');
      process.exit(0);
    }); */

    // 3. Force shutdown after 10s if hanging
    setTimeout(() => {
      console.error(
        '⚠️ Could not close connections in time, forcing shut down',
      );
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT')); // Handles Ctrl+C
}
