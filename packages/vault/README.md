# @axiomify/vault

A secure environment and configuration vault for Axiomify, providing envelope encryption (AES-256-GCM), Attribute-Based Access Control (ABAC) policies, schema validation, and memory-sealed secret lifecycle management.

---

## Features

- **Envelope Encryption**: Uses AES-256-GCM to encrypt environment variables with a Data Encryption Key (DEK), which is in turn encrypted using a Key Encryption Key (KEK).
- **Process Environment Proxying**: Replaces `process.env` with a proxy that intercepts access, checking credentials JIT and returning masked `••••••••` values to unauthorized callers.
- **Auto Stream Redaction**: Automatically intercepts standard streams (`stdout`, `stderr`) to sanitize and redact active plaintext secrets, preventing logs leaks.
- **Zero-Config Developer Fallback**: Automatically creates and manages a local developer KEK key at `.axiomify/vault.key` when external KMS/keys are absent.
- **Zod Schema Validation**: Performs boot-time validation, type coercion, and default value injection against a Zod schema.
- **Environment-Specific Vaults**: Automatically switches vault configuration files (e.g. `axiomify-vault.production.json`) based on `NODE_ENV`.
- **Checksum Caching**: Computes SHA-256 hashes of the target keys from raw env files to skip decrypt loops if the source environment configuration hasn't changed.
- **Memory Sealing**: Erases the decryption key (DEK) from memory at the end of the bootstrap phase (Strategy A), rejecting any runtime decryption requests.
- **Dynamic Secret Rotation**: Allows rotating active secrets in memory (updating caches and redactors) even after the vault is sealed.
- **Git-guard Protection**: Automatically checks if your Master KEK key `.axiomify/vault.key` is tracked by git using `git ls-files`, warning in development and throwing in production to prevent keys from leaking to version control.

---

## Installation

```bash
npm install @axiomify/vault
```

*Note: `@axiomify/core` is required as a peer dependency.*

---

## Usage

### 1. Integration in an Axiomify App (DI Container)

The recommended way to use the vault is by registering it as a module in your Axiomify application. By default, `@axiomify/core` will automatically seal the vault after bootstrapping.

```typescript
import { Axiomify, z } from '@axiomify/core';
import { vaultModule } from '@axiomify/vault';

const app = new Axiomify();

// Register the vault module with Zod schema validation and ABAC policy
app.use(
  vaultModule({
    envFiles: ['.env.default', '.env.local'], // sequentially load & override env files
    schema: z.object({
      PORT: z.coerce.number().default(3000),
      DATABASE_URL: z.string().url(),
      API_KEY: z.string(),
    }),
    policy: {
      modules: {
        database: { allow: ['DATABASE_URL'] },
        gateway: { allow: ['API_KEY', 'PORT'] },
        '*': { allow: ['PORT'] } // fallback rules
      }
    }
  })
);

app.build();
```

Once built, trying to access `process.env.DATABASE_URL` from an unauthorized caller (e.g., in a logs module or outside provider context) will return `••••••••` to prevent leaks.

### 2. Standalone Instance

You can also initialize and manage an `AxiomifyVault` instance manually:

```typescript
import { AxiomifyVault } from '@axiomify/vault';
import { z } from 'zod';

const vault = new AxiomifyVault({
  vaultPath: 'custom-vault.json',
  envFiles: '.env',
  schema: z.object({
    SECRET_KEY: z.string()
  })
});

// Decrypt on-demand
const secret = vault.resolveSecret('SECRET_KEY');

// Write new secret to the vault file
vault.setSecret('ANOTHER_SECRET', 'my-val');

// Seal vault (erases decryption keys from memory)
vault.seal();

// Once sealed, JIT resolution of uncached values throws an access error:
// vault.resolveSecret('ANOTHER_SECRET'); // Throws: Vault is sealed.
```

---

## Key Encryption Key (KEK) Resolution

The vault resolves the Master KEK using the following order of precedence:

1. **Explicit Option**: Passed via options during construction:
   ```typescript
   new AxiomifyVault({ kek: 'my-custom-hex-or-base64-key' })
   ```
2. **Environment Variable**: Loaded from `process.env.AXIOMIFY_VAULT_KEK`.
3. **Local File Fallback**: Dynamically loads or generates a local dev key at `<projectRoot>/.axiomify/vault.key`.

---

## API Reference

### `vaultModule(options: VaultOptions)`
Returns an Axiomify `AppModule` that:
- Initializes the vault.
- Sets up standard stream redaction.
- Hooks into `process.env` with a proxy handler.
- registers `'vault'` inside the dependency injection context.

### `AxiomifyVault` Class

#### `new AxiomifyVault(options?: VaultOptions)`
Initializes the instance, validates schema, updates/decrypts values, and attaches proxies.

#### `hasSecret(key: string): boolean`
Checks if the vault contains the specified secret.

#### `isAllowed(moduleName: string, key: string): boolean`
Evaluates access rules based on the active ABAC policy.

#### `resolveSecret(key: string): string`
Decrypts and retrieves a secret using the active caller context. If unauthorized, throws.

#### `setSecret(key: string, value: string): void`
Encrypts the value, registers it for stream redaction, caches it, and writes it to the vault JSON file. Throws if the vault is sealed.

#### `rotateSecret(key: string, value: string): void`
Dynamically rotates a secret in the active memory cache and redactors. Safe to call at runtime even after sealing.

#### `listSecretKeys(): string[]`
Returns a list of all secret keys currently registered in the vault.

#### `scope<T>(moduleName: string, fn: () => T): T`
Runs `fn` inside the Vault ABAC AsyncLocalStorage execution context matching `moduleName` so request-time secret resolution succeeds. Also available as `ctx.vault.scope(moduleName, fn)` inside route handlers.

#### `seal(): void`
Erase the DEK buffer in memory (Strategy A Sealing), locking the vault from further file decryption JIT lookups.

---

### Standalone Utilities

#### `vaultScope<T>(moduleName: string, fn: () => T): T`
Standalone equivalent of the `scope` method, which can be imported directly from `@axiomify/vault`.

---

## License

MIT
