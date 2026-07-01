/**
 * Axiomify Vault Production-Ready Server Example.
 *
 * Demonstrates the recommended best practices for deploying Axiomify Vault in production:
 * 1. Conditional envFiles loading (only loaded in development).
 * 2. Relying on AXIOMIFY_VAULT_KEK environment variables for production key decryption.
 * 3. Enforcing schema validation and type coercion.
 * 4. Leveraging zero-overhead memory sealing.
 *
 * Run in development:
 *   NODE_ENV=development npx ts-node examples/vault-production-server.ts
 *
 * Run in production:
 *   AXIOMIFY_VAULT_KEK=your_production_master_kek_hex NODE_ENV=production npx ts-node examples/vault-production-server.ts
 */
import { Axiomify, z, type AppModule } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { vaultModule, type AxiomifyVault } from '@axiomify/vault';

declare module '@axiomify/core' {
  interface AppServices {
    vault: AxiomifyVault;
  }
}

const app = new Axiomify();
const isDev = process.env.NODE_ENV !== 'production';

// Define configuration validation schema
const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  API_SECRET: z.string().min(10),
});

// Configure ABAC policy rules
const vaultPolicy = {
  modules: {
    'database-client': { allow: ['DATABASE_URL'] },
    'gateway-client': { allow: ['API_SECRET', 'PORT'] },
  },
};

// 1. Register the Vault module
app.use(
  vaultModule({
    // Best Practice #1: Only search/sync raw env files during development.
    // If running in production, this resolves to undefined and will NOT search for files or throw if they don't exist.
    envFiles: isDev ? ['.env.default', '.env.local'] : undefined,

    // Best Practice #2: Pass the validation schema to validate and coerce settings at startup.
    schema: configSchema,

    // Pass module policies
    policy: vaultPolicy,
  })
);

// 2. Define a secure database connector module using isolated context
const databaseModule: AppModule = {
  name: 'database-client',
  dependencies: ['vault'],
  register: (app, ctx) => {
    const vault = ctx.resolve('vault');

    app.route({
      method: 'GET',
      path: '/db-connect',
      handler: async (req, res) => {
        // Accessing the secret within the permitted scope
        const dbUrl = ctx.vault.scope('database-client', () => process.env.DATABASE_URL);
        
        // This is safe! Standard console stream redaction intercepts stdout/stderr 
        // to redact the plaintext value if accidentally logged.
        console.log('Connecting to database:', dbUrl);

        res.send({ status: 'connected', url: '••••••••' });
      },
    });
  },
};

app.use(databaseModule);

// 3. Start the application
// The default build pipeline of Axiomify automatically triggers `vault.seal()`
// after all modules boot up, erasing the DEK from memory (Best Practice #3).
app.build();

const PORT = parseInt(process.env.PORT || '3000', 10);
const adapter = new NativeAdapter(app, { port: PORT });

adapter.listen((port) => {
  console.log(`🚀 Secure production-ready vault server listening on port ${port}`);
  console.log(`🔒 Vault memory-sealed: Active decryption keys have been erased from memory.`);
});
