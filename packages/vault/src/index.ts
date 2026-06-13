import type { AppModule } from '@axiomify/core';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { decrypt, encrypt, resolveKEK, type EncryptedEnvelope } from './crypto';
import { SecretPolicyEngine, type VaultPolicy } from './policy';
import { registerSecretForRedaction, setupProcessEnvProxy, setupStreamSanitizer } from './proxy';

export interface VaultMetadata {
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

    // 1. Resolve Master Key (KEK)
    const kek = resolveKEK(this.projectRoot, this.optionsKek);

    // 2. Load or Create vault metadata envelope
    if (existsSync(this.vaultPath)) {
      try {
        const fileContent = readFileSync(this.vaultPath, 'utf8');
        const metadata: VaultMetadata = JSON.parse(fileContent);

        // Decrypt DEK using KEK
        const dekHex = decrypt(metadata.wrappedDek, kek);
        this.dek = Buffer.from(dekHex, 'hex');

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
            writeFileSync(this.vaultPath, JSON.stringify(metadata, null, 2), 'utf8');
          }
        }
      } catch (err: any) {
        throw new Error(`[Axiomify Vault] Failed to load/decrypt vault: ${err.message}`);
      }
    } else {
      // Create a new Vault
      this.dek = randomBytes(32);

      // Wrap DEK with KEK
      const wrappedDek = encrypt(this.dek.toString('hex'), kek);
      const metadata: VaultMetadata = {
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
      writeFileSync(this.vaultPath, JSON.stringify(metadata, null, 2), 'utf8');
    }

    // 3. Inject process.env Proxy and wrap standard streams
    setupProcessEnvProxy(this);
    setupStreamSanitizer();

    // 4. Validate Schema at boot time and cache variables
    this.validateSchema();
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
      } catch (err) {
        // Ignore errors if already sealed
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
   * Seals the vault, erasing the Data Encryption Key (DEK) from memory.
   */
  public seal(): void {
    if (this.sealed) return;
    this.sealed = true;
    if (this.dek) {
      // Wipes the DEK buffer in memory to prevent memory inspection
      this.dek.fill(0);
      this.dek = undefined as any;
    }
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
    const kek = resolveKEK(this.projectRoot, this.optionsKek);
    const envelope = encrypt(value, this.dek);
    this.encryptedSecrets.set(key, envelope);

    // Save to file
    const wrappedDek = encrypt(this.dek.toString('hex'), kek);
    const secretsObj: Record<string, EncryptedEnvelope> = {};
    for (const [k, ev] of this.encryptedSecrets.entries()) {
      secretsObj[k] = ev;
    }

    const metadata: VaultMetadata = {
      wrappedDek,
      secrets: secretsObj,
    };

    writeFileSync(this.vaultPath, JSON.stringify(metadata, null, 2), 'utf8');

    // Register secret for stdout sanitization
    registerSecretForRedaction(value);
  }

  /**
   * Dynamically updates/rotates a secret in memory.
   * This updates the active cache and sanitizers, and can be called at runtime post-bootstrap (when sealed).
   */
  public rotateSecret(key: string, value: string): void {
    this.secretsCache.set(key, value);
    registerSecretForRedaction(value);
  }
}

/**
 * Simple .env file parser.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf8');
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
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
