import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Axiomify, z } from '@axiomify/core';
import { AxiomifyVault, vaultModule } from '../src/index';
import { restoreProcessEnv } from '../src/proxy';

describe('Axiomify Vault', () => {
  const testRoot = join(__dirname, 'test-vault-env');

  beforeEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    restoreProcessEnv();
    delete process.env.NODE_ENV;
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('should initialize local KEK and vault.json file correctly', () => {
    // Set a process.env variable to seed the initial vault template
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['DATABASE_URL'] }
        }
      }
    });
    expect(existsSync(join(testRoot, '.axiomify', 'vault.key'))).toBe(true);
    expect(existsSync(vault.vaultPath)).toBe(true);

    // Retrieve database secret via vault
    const dbUrl = vault.resolveSecret('DATABASE_URL');
    expect(dbUrl).toBe('postgresql://localhost:5432/test');
  });

  it('should encrypt and decrypt secrets on-demand', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['CUSTOM_API_KEY'] }
        }
      }
    });
    vault.setSecret('CUSTOM_API_KEY', 'secure-key-123456');

    // Retrieve secret JIT
    const resolved = vault.resolveSecret('CUSTOM_API_KEY');
    expect(resolved).toBe('secure-key-123456');
  });

  it('should enforce ABAC policy checks for modules', () => {
    const policy = {
      modules: {
        'users': { allow: ['DATABASE_URL'] },
        'billing': { allow: ['STRIPE_SECRET'] },
        '*': { allow: ['PUBLIC_VAR'] }
      }
    };

    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy
    });
    vault.setSecret('DATABASE_URL', 'db-conn-string');
    vault.setSecret('STRIPE_SECRET', 'sk_test_51');
    vault.setSecret('PUBLIC_VAR', 'hello-world');

    // Direct allowed policy matches
    expect(vault.isAllowed('users', 'DATABASE_URL')).toBe(true);
    expect(vault.isAllowed('users', 'STRIPE_SECRET')).toBe(false);
    expect(vault.isAllowed('billing', 'STRIPE_SECRET')).toBe(true);
    
    // Wildcard matching
    expect(vault.isAllowed('any-other', 'PUBLIC_VAR')).toBe(true);
    expect(vault.isAllowed('any-other', 'DATABASE_URL')).toBe(false);
  });

  it('should register within the Axiomify core DI container via vaultModule', async () => {
    const app = new Axiomify();
    app.use(vaultModule({ projectRoot: testRoot }));
    app.build();

    const vaultInstance = (app as any)._services.get('vault');
    expect(vaultInstance).toBeDefined();
    expect(vaultInstance).toBeInstanceOf(AxiomifyVault);
  });

  it('should seal the vault post-bootstrap and reject subsequent JIT decryption', async () => {
    // Seed initial env value
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

    const app = new Axiomify();
    app.use(vaultModule({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['DATABASE_URL', 'LATE_KEY'] }
        }
      }
    }));
    
    const vaultInstance = (app as any)._services.get('vault') as AxiomifyVault;
    vaultInstance.setSecret('LATE_KEY', 'late-val');

    // Access DATABASE_URL to cache it in this instance
    vaultInstance.resolveSecret('DATABASE_URL');

    // Build the application, which triggers sealing the vault
    app.build();

    // Already cached secrets should still be readable
    expect(vaultInstance.resolveSecret('DATABASE_URL')).toBe('postgresql://localhost:5432/test');

    // Trying to resolve an uncached/new secret post-bootstrap must throw an Access Denied error
    expect(() => vaultInstance.resolveSecret('LATE_KEY')).toThrow('Vault is sealed');
  });

  it('should support custom vault path configuration', () => {
    process.env.MY_CONFIG_SECRET = 'custom-path-secret';

    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      vaultPath: 'my-custom-vault-file.json',
      policy: {
        modules: {
          default: { allow: ['MY_CONFIG_SECRET'] }
        }
      }
    });

    expect(existsSync(join(testRoot, 'my-custom-vault-file.json'))).toBe(true);
    expect(vault.resolveSecret('MY_CONFIG_SECRET')).toBe('custom-path-secret');
  });

  it('should support environment swapping based on NODE_ENV', () => {
    process.env.NODE_ENV = 'staging';
    process.env.ENV_SPECIFIC_SECRET = 'staging-secret-value';

    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['ENV_SPECIFIC_SECRET'] }
        }
      }
    });

    expect(existsSync(join(testRoot, 'axiomify-vault.staging.json'))).toBe(true);
    expect(vault.resolveSecret('ENV_SPECIFIC_SECRET')).toBe('staging-secret-value');
  });

  it('should support importing from custom raw env files and arrays of env files with overrides', () => {
    if (!existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    const fs = require('node:fs');
    fs.mkdirSync(testRoot, { recursive: true });

    // Setup mock env files
    writeFileSync(join(testRoot, '.env.default'), 'PORT=8080\nAPI_URL=https://api.default.com\n', 'utf8');
    writeFileSync(join(testRoot, '.env.local'), 'API_URL=https://api.local.dev\n', 'utf8');

    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      envFiles: ['.env.default', '.env.local'],
      policy: {
        modules: {
          default: { allow: ['PORT', 'API_URL'] }
        }
      }
    });

    expect(vault.resolveSecret('PORT')).toBe('8080');
    expect(vault.resolveSecret('API_URL')).toBe('https://api.local.dev');
  });

  it('should validate schemas at boot time, throw on missing/invalid, and inject defaults', () => {
    // 1. Validation Fail: Missing required environment variables
    const schema = z.object({
      PORT: z.coerce.number().default(3000),
      API_SECRET: z.string(),
    });

    expect(() => new AxiomifyVault({
      projectRoot: testRoot,
      schema,
    })).toThrow('Schema Validation Failed');

    // 2. Validation Pass: Coerces types and injects defaults
    // Setup raw env first
    const fs = require('node:fs');
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(testRoot, { recursive: true });
    writeFileSync(join(testRoot, '.env'), 'API_SECRET=super-secure-token\n', 'utf8');

    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      schema,
      policy: {
        modules: {
          default: { allow: ['PORT', 'API_SECRET'] }
        }
      }
    });

    // Check defaults and decrypted secrets are fully active and cached
    expect(vault.resolveSecret('PORT')).toBe('3000');
    expect(vault.resolveSecret('API_SECRET')).toBe('super-secure-token');
  });

  it('should support custom KEK buffers and environmental KEK variables', () => {
    const rawKey = require('node:crypto').randomBytes(32);
    const keyHex = rawKey.toString('hex');

    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      kek: keyHex,
      policy: {
        modules: {
          default: { allow: ['SEC_TEST'] }
        }
      }
    });

    vault.setSecret('SEC_TEST', 'my-val-secured');
    expect(vault.resolveSecret('SEC_TEST')).toBe('my-val-secured');
  });

  it('should support dynamic secret rotation in memory at runtime when sealed', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['ROTATED_VAL'] }
        }
      }
    });

    vault.setSecret('ROTATED_VAL', 'initial-state');
    expect(vault.resolveSecret('ROTATED_VAL')).toBe('initial-state');

    // Seal the vault
    vault.seal();

    // Verify JIT decryption throws
    expect(() => vault.resolveSecretJIT('ANY_OTHER')).toThrow('Vault is sealed');

    // Perform dynamic runtime rotation (updates the memory cache directly)
    vault.rotateSecret('ROTATED_VAL', 'newly-rotated-state');

    // Verify the rotated value is returned successfully
    expect(vault.resolveSecret('ROTATED_VAL')).toBe('newly-rotated-state');
  });

  it('should automatically sync and update the vault when raw env files change', () => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    const fs = require('node:fs');
    fs.mkdirSync(testRoot, { recursive: true });

    // 1. Initial creation
    writeFileSync(join(testRoot, '.env'), 'MY_VAR=initial-value\n', 'utf8');
    const vault1 = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['MY_VAR', 'NEW_VAR'] }
        }
      }
    });
    expect(vault1.resolveSecret('MY_VAR')).toBe('initial-value');

    // 2. Modify value and add new key in .env
    writeFileSync(join(testRoot, '.env'), 'MY_VAR=updated-value\nNEW_VAR=hello-world\n', 'utf8');
    
    // Instantiate again (reboots the vault, triggering auto sync)
    const vault2 = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['MY_VAR', 'NEW_VAR'] }
        }
      }
    });

    expect(vault2.resolveSecret('MY_VAR')).toBe('updated-value');
    expect(vault2.resolveSecret('NEW_VAR')).toBe('hello-world');
  });

  it('should support direct process.env mutations and sync with vault cache', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['MUTATED_ENV_SECRET'] }
        }
      }
    });

    vault.setSecret('MUTATED_ENV_SECRET', 'initial-val');
    expect(process.env.MUTATED_ENV_SECRET).toBe('initial-val');

    // Mutate directly on process.env
    process.env.MUTATED_ENV_SECRET = 'mutated-val';
    expect(process.env.MUTATED_ENV_SECRET).toBe('mutated-val');
    expect(vault.resolveSecret('MUTATED_ENV_SECRET')).toBe('mutated-val');

    // Delete directly from process.env
    delete process.env.MUTATED_ENV_SECRET;
    expect(process.env.MUTATED_ENV_SECRET).toBeUndefined();
  });
});
