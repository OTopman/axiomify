/**
 * Axiomify Vault Server Example.
 *
 * Demonstrates:
 * - Registering the `@axiomify/vault` module in the DI container.
 * - Loading from local raw `.env` or custom env file arrays.
 * - Boot-time Zod schema validation, default injection, and type coercion.
 * - Enforcing Attribute-Based Access Control (ABAC) module authorization.
 * - Automatic masking in process.env and console stream redaction.
 */
import { Axiomify, z, type AppModule } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { vaultModule, type AxiomifyVault } from '@axiomify/vault';

// Extend AppServices interface to include type information for the vault
declare module '@axiomify/core' {
  interface AppServices {
    vault: AxiomifyVault;
  }
}

const app = new Axiomify();

// 1. Register the Vault module
app.use(
  vaultModule({
    // Load from environment files with priority overrides
    envFiles: ['.env.default', '.env.local'],

    // Define Zod schema for environment configuration
    schema: z.object({
      PORT: z.coerce.number().default(3000),
      DATABASE_URL: z.string().url(),
      API_KEY: z.string().min(5),
    }),

    // Configure ABAC policy rules to isolate credentials
    policy: {
      modules: {
        database: { allow: ['DATABASE_URL'] },
        'my-routes': { allow: ['API_KEY', 'PORT'] },
      },
    },
  })
);

// 2. Define a routes module that depends on the vault service
const routesModule: AppModule = {
  name: 'my-routes',
  dependencies: ['vault'],
  register: (app, ctx) => {
    // Resolve the vault service from the DI container during bootstrap
    const vault = ctx.resolve('vault');

    app.route({
      method: 'GET',
      path: '/db-check',
      handler: async (req, res) => {
        // Accessing through process.env will return masked value by default
        console.log('Accessed via process.env.DATABASE_URL:', process.env.DATABASE_URL); // "••••••••"
        
        try {
          // Resolve the secret JIT. Note: since the caller context is "my-routes",
          // and the policy only allows "database" module to read DATABASE_URL, this will throw.
          const dbUrl = vault.resolveSecret('DATABASE_URL');
          res.send({ dbUrl });
        } catch (err: any) {
          res.status(403).send({ error: err.message });
        }
      },
    });

    app.route({
      method: 'GET',
      path: '/gateway-check',
      handler: async (req, res) => {
        // Check if the current context (my-routes) is allowed to access API_KEY
        const allowed = vault.isAllowed('my-routes', 'API_KEY');
        
        // Wrap secret resolution in vault scope to temporarily unmask API_KEY for this module:
        const unmaskedKey = ctx.vault.scope('my-routes', () => process.env.API_KEY);
        
        res.send({
          allowed,
          apiKeyMasked: process.env.API_KEY, // returns masked "••••••••"
          apiKeyUnmasked: unmaskedKey,      // returns the actual unmasked API_KEY!
        });
      },
    });
  }
};

app.use(routesModule);

const PORT = parseInt(process.env.PORT || '3000', 10);
const adapter = new NativeAdapter(app, { port: PORT });

if (require.main === module) {
  adapter.listen((port) => {
    console.log(`🚀 Vault Server running on port ${port}`);
    console.log(`🔒 Active decryption keys will be wiped from memory on boot-up`);
  });
}

