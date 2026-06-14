import type { AppModule } from '@axiomify/core';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { decrypt, encrypt, resolveKEK, type EncryptedEnvelope } from './crypto';
import { SecretPolicyEngine, type VaultPolicy } from './policy';
import { registerSecretForRedaction, unregisterSecretForRedaction, setupProcessEnvProxy, setupStreamSanitizer, vaultScope } from './proxy';

export { vaultScope };

export interface VaultMetadata {
  version: number;
  wrappedDek: EncryptedEnvelope;
  secrets: Record<string, EncryptedEnvelope>;
  sourceChecksum?: string;
}

export interface VaultOptions {
  /**
   * The custom filename or absolute path to read/write the vault JSON from.
   * If not provided, the vault automatically resolves based on NODE_ENV:
   * 1. Looks for `axiomify-vault.${process.env.NODE_ENV}.json` (e.g. `axiomify-vault.production.json`)
   * 2. Falls back to `axiomify-vault.json`
   */
  vaultPath?: string;

  /**
   * The file path(s) to import raw environment variables from during first-time encryption.
   * Can be a single string or an array of strings (e.g., ['.env.default', '.env.local']).
   * Later files in the array override earlier ones.
   */
  envFiles?: string | string[];

  /**
   * ABAC module policy.
   */
  policy?: VaultPolicy;

  /**
   * Zod schema to validate environment variables during application bootstrap.
   */
  schema?: any;

  /**
   * The project root directory. Defaults to process.cwd().
   */
  projectRoot?: string;

  /**
   * Custom Key Encryption Key (KEK) buffer or hex/base64 encoded key string.
   * If not provided, it falls back to process.env.AXIOMIFY_VAULT_KEK,
   * and finally falls back to the local file ".axiomify/vault.key".
   */
  kek?: Buffer | string;
}

/** Current vault metadata format version. */
const VAULT_VERSION = 2;

export class AxiomifyVault {
  private dek!: Buffer;
  private secretsCache = new Map<string, string>();
  private encryptedSecrets = new Map<string, EncryptedEnvelope>();
  private policyEngine: SecretPolicyEngine;
  public readonly vaultPath: string;
  private sealed = false;
  private projectRoot: string;
  private policy: VaultPolicy | undefined;
  private schema: any;
  private envFiles: string | string[] | undefined;
  private optionsKek: Buffer | string | undefined;
  /** Cached resolved KEK — avoids re-reading filesystem on every setSecret */
  private kek!: Buffer;

  constructor(options: VaultOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.policy = options.policy;
    this.schema = options.schema;
    this.envFiles = options.envFiles;
    this.optionsKek = options.kek;

    const env = process.env.NODE_ENV;
    if (options.vaultPath) {
      this.vaultPath = isAbsolute(options.vaultPath)
        ? options.vaultPath
        : join(this.projectRoot, options.vaultPath);
    } else {
      const envFile = env ? `axiomify-vault.${env}.json` : 'axiomify-vault.json';
      this.vaultPath = join(this.projectRoot, envFile);
    }

    this.policyEngine = new SecretPolicyEngine(this.policy);
    this.initialize();
  }

  /**
   * Initialize Vault keys and load encrypted envelope.
   */
  private initialize(): void {
    const parentDir = dirname(this.vaultPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // 1. Resolve and cache Master Key (KEK)
    this.kek = resolveKEK(this.projectRoot, this.optionsKek);

    const isUsingLocalKeyFile = !this.optionsKek && !process.env.AXIOMIFY_VAULT_KEK;
    if (isUsingLocalKeyFile) {
      this.checkKeyNotGitTracked(join(this.projectRoot, '.axiomify', 'vault.key'));
    }

    // 2. Load or Create vault metadata envelope
    if (existsSync(this.vaultPath)) {
      try {
        const fileContent = readFileSync(this.vaultPath, 'utf8');
        const metadata: VaultMetadata = JSON.parse(fileContent);

        // Decrypt DEK using KEK
        const dekEncoded = decrypt(metadata.wrappedDek, this.kek);
        if (dekEncoded.length === 64 && /^[0-9a-fA-F]{64}$/.test(dekEncoded)) {
          this.dek = Buffer.from(dekEncoded, 'hex');
        } else {
          this.dek = Buffer.from(dekEncoded, 'base64');
        }

        // Load encrypted secrets map
        for (const [key, env] of Object.entries(metadata.secrets)) {
          this.encryptedSecrets.set(key, env);
        }

        // --- Auto Sync Check ---
        // Check if raw env sources exist. If yes, we check for updates
        const filesToLoad = Array.isArray(this.envFiles)
          ? this.envFiles
          : this.envFiles
            ? [this.envFiles]
            : [];

        let sourceEnv: Record<string, string | undefined> | null = null;
        if (filesToLoad.length > 0) {
          sourceEnv = {};
          for (const file of filesToLoad) {
            const fullEnvPath = isAbsolute(file) ? file : join(this.projectRoot, file);
            if (existsSync(fullEnvPath)) {
              const parsed = parseEnvFile(fullEnvPath);
              sourceEnv = { ...sourceEnv, ...parsed };
            } else {
              throw new Error(`[Axiomify Vault] Configured env file not found at: ${fullEnvPath}`);
            }
          }
        } else {
          const defaultEnvPath = join(this.projectRoot, '.env');
          if (existsSync(defaultEnvPath)) {
            sourceEnv = parseEnvFile(defaultEnvPath);
          }
        }

        if (sourceEnv) {
          const targetKeys = new Set<string>([
            ...getPolicyKeys(this.policy),
            ...getZodSchemaKeys(this.schema)
          ]);

          const currentChecksum = calculateConfigChecksum(sourceEnv, targetKeys);

          if (metadata.sourceChecksum !== currentChecksum) {
            let hasChanges = false;

            // 1. Add or Update changed keys
            for (const key of targetKeys) {
              const rawVal = sourceEnv[key];
              if (rawVal !== undefined) {
                const existingEnv = this.encryptedSecrets.get(key);
                let shouldUpdate = false;
                if (!existingEnv) {
                  shouldUpdate = true;
                } else {
                  try {
                    const decrypted = decrypt(existingEnv, this.dek);
                    if (decrypted !== rawVal) {
                      shouldUpdate = true;
                    }
                  } catch {
                    shouldUpdate = true;
                  }
                }

                if (shouldUpdate) {
                  const newEnv = encrypt(rawVal, this.dek);
                  metadata.secrets[key] = newEnv;
                  this.encryptedSecrets.set(key, newEnv);
                  hasChanges = true;
                }
              }
            }

            // 2. Remove keys no longer in policy or schema
            for (const key of Object.keys(metadata.secrets)) {
              if (!targetKeys.has(key)) {
                delete metadata.secrets[key];
                this.encryptedSecrets.delete(key);
                hasChanges = true;
              }
            }

            metadata.sourceChecksum = currentChecksum;
            metadata.version = VAULT_VERSION;
            this.writeVaultFile(metadata);
          }
        }
      } catch (err: any) {
        throw new Error(`[Axiomify Vault] Failed to load/decrypt vault: ${err.message}`);
      }
    } else {
      // Create a new Vault
      this.dek = randomBytes(32);

      // Wrap DEK with KEK using base64 encoding (v2)
      const wrappedDek = encrypt(this.dek.toString('base64'), this.kek);
      const metadata: VaultMetadata = {
        version: VAULT_VERSION,
        wrappedDek,
        secrets: {},
      };

      // Import raw environment variables if configured or default to .env/process.env
      let sourceEnv: Record<string, string | undefined> = {};
      const filesToLoad = Array.isArray(this.envFiles)
        ? this.envFiles
        : this.envFiles
          ? [this.envFiles]
          : [];

      if (filesToLoad.length > 0) {
        for (const file of filesToLoad) {
          const fullEnvPath = isAbsolute(file)
            ? file
            : join(this.projectRoot, file);
          if (existsSync(fullEnvPath)) {
            const parsed = parseEnvFile(fullEnvPath);
            sourceEnv = { ...sourceEnv, ...parsed };
          } else {
            throw new Error(`[Axiomify Vault] Configured env file not found at: ${fullEnvPath}`);
          }
        }
      } else {
        const defaultEnvPath = join(this.projectRoot, '.env');
        if (existsSync(defaultEnvPath)) {
          sourceEnv = parseEnvFile(defaultEnvPath);
        } else {
          sourceEnv = process.env;
        }
      }

      // We encrypt only the keys defined in the policy or schema
      const targetKeys = new Set<string>([
        ...getPolicyKeys(this.policy),
        ...getZodSchemaKeys(this.schema)
      ]);

      for (const key of targetKeys) {
        const val = sourceEnv[key];
        if (val) {
          metadata.secrets[key] = encrypt(val, this.dek);
          this.encryptedSecrets.set(key, metadata.secrets[key]);
        }
      }

      metadata.sourceChecksum = calculateConfigChecksum(sourceEnv, targetKeys);
      this.writeVaultFile(metadata);
    }

    // 3. Inject process.env Proxy and wrap standard streams
    setupProcessEnvProxy(this);
    setupStreamSanitizer();

    // 4. Validate Schema at boot time and cache variables
    this.validateSchema();
  }

  /**
   * Writes vault metadata to the vault file with restrictive permissions (0600).
   */
  private writeVaultFile(metadata: VaultMetadata): void {
    writeFileSync(this.vaultPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Pre-decrypts and validates env against schema.
   */
  private validateSchema(): void {
    const envObj: Record<string, any> = { ...process.env };
    for (const key of this.encryptedSecrets.keys()) {
      try {
        const decrypted = this.resolveSecretJIT(key);
        envObj[key] = decrypted;
      } catch (err: any) {
        // Warn on decrypt errors so developers can see which keys failed
        console.warn(`[Axiomify Vault] Warning: Failed to decrypt secret "${key}" during schema validation: ${err.message}`);
      }
    }

    if (this.schema) {
      if (typeof this.schema.safeParse === 'function') {
        const result = this.schema.safeParse(envObj);
        if (!result.success) {
          const issues = result.error.issues || result.error.errors || [];
          throw new Error(
            `[Axiomify Vault] Schema Validation Failed:\n` +
            issues
              .map((e: any) => `  - ${e.path.join('.')}: ${e.message}`)
              .join('\n')
          );
        }
        // Inject coerced/default values back into the cache
        for (const [k, v] of Object.entries(result.data)) {
          if (v !== undefined) {
            const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            this.secretsCache.set(k, valStr);
          }
        }
      } else if (typeof this.schema.parse === 'function') {
        try {
          const parsed = this.schema.parse(envObj);
          for (const [k, v] of Object.entries(parsed)) {
            if (v !== undefined) {
              const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
              this.secretsCache.set(k, valStr);
            }
          }
        } catch (err: any) {
          throw new Error(`[Axiomify Vault] Schema Validation Failed: ${err.message}`);
        }
      }
    }
  }

  /**
   * Check if a secret exists in the vault.
   */
  public hasSecret(key: string): boolean {
    return this.encryptedSecrets.has(key);
  }

  /**
   * Checks if a calling module is allowed to access the specified secret.
   */
  public isAllowed(moduleName: string, key: string): boolean {
    return this.policyEngine.isAllowed(moduleName, key);
  }

  /**
   * Resolves a secret JIT (Just-In-Time) with policy check.
   */
  public resolveSecret(key: string): string {
    const callerName = (globalThis as any)._axiomifyVaultContext?.getStore() || 'default';
    if (!this.isAllowed(callerName, key)) {
      throw new Error(`[Axiomify Vault] Access Denied: Module "${callerName}" is not permitted to read secret "${key}".`);
    }
    return this.resolveSecretJIT(key);
  }

  /**
   * Seals the vault, erasing the Data Encryption Key (DEK) from memory
   * and clearing the plaintext secrets cache.
   */
  public seal(): void {
    if (this.sealed) return;
    this.sealed = true;
    if (this.dek) {
      // Wipes the DEK buffer in memory to prevent memory inspection
      this.dek.fill(0);
      this.dek = undefined as any;
    }
    // Clear plaintext secrets from cache (V8 strings can't be zero-wiped,
    // but removing references allows GC to collect them)
    this.secretsCache.clear();
  }

  /**
   * Decrypts a secret from the internal cache or envelope.
   */
  public resolveSecretJIT(key: string): string {
    if (this.secretsCache.has(key)) {
      return this.secretsCache.get(key)!;
    }

    if (this.sealed) {
      throw new Error(`[Axiomify Vault] Access Denied: Vault is sealed. Secret "${key}" cannot be decrypted post-bootstrap.`);
    }

    const envelope = this.encryptedSecrets.get(key);
    if (!envelope) {
      throw new Error(`[Axiomify Vault] Secret "${key}" not found in vault.`);
    }

    const decrypted = decrypt(envelope, this.dek);
    this.secretsCache.set(key, decrypted);
    registerSecretForRedaction(decrypted);

    return decrypted;
  }

  /**
   * Sets (encrypts and saves) a secret in the vault.
   */
  public setSecret(key: string, value: string): void {
    if (this.sealed) {
      throw new Error(`[Axiomify Vault] Access Denied: Vault is sealed. Cannot add new secret "${key}".`);
    }
    const envelope = encrypt(value, this.dek);
    this.encryptedSecrets.set(key, envelope);

    // Save to file using cached KEK
    const wrappedDek = encrypt(this.dek.toString('base64'), this.kek);
    const secretsObj: Record<string, EncryptedEnvelope> = {};
    for (const [k, ev] of this.encryptedSecrets.entries()) {
      secretsObj[k] = ev;
    }

    const metadata: VaultMetadata = {
      version: VAULT_VERSION,
      wrappedDek,
      secrets: secretsObj,
    };

    this.writeVaultFile(metadata);

    // Register secret for stdout sanitization
    registerSecretForRedaction(value);
  }

  /**
   * Dynamically updates/rotates a secret in memory and persists to vault if unsealed.
   * Removes the old secret value from the redaction set before adding the new one.
   */
  public rotateSecret(key: string, value: string): void {
    // Remove old value from redaction set
    const oldValue = this.secretsCache.get(key);
    if (oldValue) {
      unregisterSecretForRedaction(oldValue);
    }

    this.secretsCache.set(key, value);
    registerSecretForRedaction(value);

    // Persist to vault file if not sealed (DEK is still available)
    if (!this.sealed && this.dek) {
      try {
        const envelope = encrypt(value, this.dek);
        this.encryptedSecrets.set(key, envelope);

        const wrappedDek = encrypt(this.dek.toString('base64'), this.kek);
        const secretsObj: Record<string, EncryptedEnvelope> = {};
        for (const [k, ev] of this.encryptedSecrets.entries()) {
          secretsObj[k] = ev;
        }
        const metadata: VaultMetadata = {
          version: VAULT_VERSION,
          wrappedDek,
          secrets: secretsObj,
        };
        this.writeVaultFile(metadata);
      } catch {
        // Non-critical: rotation still works in memory
      }
    }
  }

  /**
   * Removes a secret from the vault's cache, encrypted secrets map, and redaction set.
   * Used by the process.env proxy deleteProperty trap.
   */
  public removeSecret(key: string): void {
    const oldValue = this.secretsCache.get(key);
    if (oldValue) {
      unregisterSecretForRedaction(oldValue);
    }
    this.secretsCache.delete(key);
    this.encryptedSecrets.delete(key);
  }

  /**
   * Returns a list of all encrypted secret keys stored in the vault.
   */
  public listSecretKeys(): string[] {
    return Array.from(this.encryptedSecrets.keys());
  }

  /**
   * Run a function within the vault ALS context under a specific module name.
   */
  public scope<T>(moduleName: string, fn: () => T): T {
    return vaultScope(moduleName, fn);
  }

  private checkKeyNotGitTracked(keyPath: string): void {
    try {
      const { execSync } = require('node:child_process');
      execSync(`git ls-files --error-unmatch "${keyPath}" 2>&1`, {
        cwd: this.projectRoot, stdio: 'pipe'
      });
      const isProd = process.env.NODE_ENV === 'production';
      const msg = `[Axiomify Vault] CRITICAL: vault.key is tracked by git at "${keyPath}". ` +
        `This will expose all encrypted secrets if pushed. Add ".axiomify/" to .gitignore immediately.`;
      if (isProd) {
        throw new Error(msg);
      }
      console.warn(msg);
    } catch (e: any) {
      if (e.status === 1) return;
      if (e.message && e.message.includes('[Axiomify Vault] CRITICAL')) {
        throw e;
      }
    }
  }
}

/**
 * Enhanced .env file parser.
 * Supports:
 * - `export` prefix stripping
 * - Inline comment stripping (outside quotes)
 * - Basic escape sequences (\n, \\) within double-quoted values
 * - Single and double quoted values
 *
 * Does NOT support multiline values.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf8');
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Strip leading 'export ' prefix
    if (trimmed.startsWith('export ')) {
      trimmed = trimmed.substring(7).trim();
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();

      if (val.startsWith('"') && val.endsWith('"')) {
        // Double-quoted: process escape sequences
        val = val.slice(1, -1);
        val = val.replace(/\\n/g, '\n')
                 .replace(/\\t/g, '\t')
                 .replace(/\\\\/g, '\\')
                 .replace(/\\"/g, '"');
      } else if (val.startsWith("'") && val.endsWith("'")) {
        // Single-quoted: literal value, no escape processing
        val = val.slice(1, -1);
      } else {
        // Unquoted: strip inline comments (# preceded by whitespace)
        const commentIdx = val.search(/\s+#/);
        if (commentIdx > 0) {
          val = val.substring(0, commentIdx).trim();
        }
      }

      result[key] = val;
    }
  }
  return result;
}

function getZodSchemaKeys(schema: any): string[] {
  if (!schema) return [];
  if (schema.shape) {
    return Object.keys(schema.shape);
  }
  if (schema._def && schema._def.schema) {
    return getZodSchemaKeys(schema._def.schema);
  }
  if (schema._def && schema._def.innerType) {
    return getZodSchemaKeys(schema._def.innerType);
  }
  return [];
}

function getPolicyKeys(policy: VaultPolicy | undefined): string[] {
  if (!policy || !policy.modules) return [];
  const keys = new Set<string>();
  for (const modulePolicy of Object.values(policy.modules)) {
    if (modulePolicy.allow) {
      for (const key of modulePolicy.allow) {
        keys.add(key);
      }
    }
  }
  return Array.from(keys);
}

export function calculateConfigChecksum(
  sourceEnv: Record<string, string | undefined>,
  targetKeys: Set<string>
): string {
  const targetConfig: Record<string, string> = {};
  for (const key of Array.from(targetKeys).sort()) {
    const val = sourceEnv[key];
    if (val !== undefined) {
      targetConfig[key] = val;
    }
  }
  return createHash('sha256').update(JSON.stringify(targetConfig)).digest('hex');
}


/**
 * Axiomify AppModule to register Vault in the DI container.
 * Supports legacy vaultModule(policyData, projectRoot) and new vaultModule(options).
 */
export const vaultModule = (
  optionsOrPolicy?: VaultOptions | VaultPolicy,
  projectRoot = process.cwd()
): AppModule => {
  let opts: VaultOptions = {};
  if (optionsOrPolicy) {
    if ('modules' in optionsOrPolicy) {
      // Legacy VaultPolicy format
      opts = { policy: optionsOrPolicy as VaultPolicy, projectRoot };
    } else {
      opts = optionsOrPolicy as VaultOptions;
      if (!opts.projectRoot) opts.projectRoot = projectRoot;
    }
  } else {
    opts = { projectRoot };
  }
  return {
    name: 'vault',
    register: (app, ctx) => {
      const vault = new AxiomifyVault(opts);
      ctx.provide('vault', vault);
    },
  };
};

declare module '@axiomify/core' {
  interface AppServices {
    vault: AxiomifyVault;
  }
}
