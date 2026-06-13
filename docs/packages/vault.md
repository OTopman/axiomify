# @axiomify/vault

Secure environment and configuration vault with envelope encryption, ABAC module policies, Zod schema validation, and memory-sealed secret lifecycle management.

## Install

```bash
npm install @axiomify/vault
```

## Export

- `vaultModule(options?: VaultOptions)`
- `AxiomifyVault` (core class)
- `parseEnvFile(filePath: string)`
- `calculateConfigChecksum(sourceEnv: Record<string, string | undefined>, targetKeys: Set<string>)`

## Key options

- `vaultPath`: path or file name of the encrypted JSON vault (defaults to environment-isolated file: `axiomify-vault.${process.env.NODE_ENV}.json` or `axiomify-vault.json`)
- `envFiles`: string path or array of paths to load environment variables from with priorities (e.g. `['.env.default', '.env.local']`)
- `policy`: ABAC policies defining modules authorization (`{ modules: { [moduleName]: { allow: string[] } } }`)
- `schema`: Zod validation schema to perform coercion, defaults injection, and missing checks
- `projectRoot`: root directory of the project (defaults to `process.cwd()`)
- `kek`: custom Buffer or string Key Encryption Key (KEK) to wrap/unwrap the DEK

## Example

```ts
import { Axiomify, z } from '@axiomify/core';
import { vaultModule } from '@axiomify/vault';

const app = new Axiomify();

app.use(
  vaultModule({
    envFiles: ['.env.default', '.env.local'],
    schema: z.object({
      PORT: z.coerce.number().default(8080),
      DB_URL: z.string(),
      API_KEY: z.string(),
    }),
    policy: {
      modules: {
        database: { allow: ['DB_URL'] },
        gateway: { allow: ['API_KEY', 'PORT'] },
      },
    },
  })
);

app.build();
```

## Behavior

- **Automatic Encryption**: Auto-detects and encrypts raw source configuration values on first run into an envelope.
- **Process Environment Proxying**: Masks sensitive environment variables to unauthorized modules returning `••••••••`.
- **Stdout/Stderr Redaction**: Hooks into standard stream `write` methods, dynamically redacting all active decrypted secrets from console output.
- **Boot-Time Schema Validation**: Validates the complete environment configuration using the provided Zod schema. Inserts defaults and type coercions back to `process.env`.
- **Memory Sealing (Strategy A)**: Erases the Data Encryption Key (DEK) from memory at the end of bootstrap phase, making JIT decryption requests fail post-bootstrap.
- **Automatic Sync Detection**: Compares raw env files checksum at start; regenerates the vault if values or policy target configurations change.
- **Dynamic Rotation**: Supports the `rotateSecret(key, value)` method at runtime to update memory caches and stream sanitizers on-the-fly post-bootstrap.
