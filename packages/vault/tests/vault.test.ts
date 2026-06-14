import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Axiomify, z } from '@axiomify/core';
import { AxiomifyVault, vaultModule, vaultScope } from '../src/index';
import { restoreProcessEnv, getCallerModuleName } from '../src/proxy';
import { encrypt, decrypt, resolveKEK } from '../src/crypto';

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

    // After seal, ALL secrets should be inaccessible (cache is cleared for security)
    expect(() => vaultInstance.resolveSecret('DATABASE_URL')).toThrow('Vault is sealed');

    // Trying to resolve any secret post-seal must throw an Access Denied error
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

  it('should support absolute vault path configuration', () => {
    const absolutePath = join(testRoot, 'my-absolute-vault.json');
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      vaultPath: absolutePath,
      policy: {
        modules: {
          default: { allow: ['SEC'] }
        }
      }
    });
    expect(vault.vaultPath).toBe(absolutePath);
  });

  it('should throw if configured env file does not exist', () => {
    expect(() => new AxiomifyVault({
      projectRoot: testRoot,
      envFiles: 'missing-file.env',
    })).toThrow('[Axiomify Vault] Configured env file not found');
  });

  it('should throw if configured env file does not exist when loading existing vault', () => {
    new AxiomifyVault({
      projectRoot: testRoot,
    });
    expect(() => new AxiomifyVault({
      projectRoot: testRoot,
      envFiles: 'non-existent.env',
    })).toThrow('[Axiomify Vault] Configured env file not found');
  });

  it('should remove keys from vault metadata if they are no longer in the policy or schema during auto-sync', () => {
    const fs = require('node:fs');
    if (!existsSync(testRoot)) {
      fs.mkdirSync(testRoot, { recursive: true });
    }
    writeFileSync(join(testRoot, '.env'), 'VAR_A=1\nVAR_B=2\n', 'utf8');
    new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['VAR_A', 'VAR_B'] }
        }
      }
    });

    const fileContent1 = fs.readFileSync(join(testRoot, 'axiomify-vault.json'), 'utf8');
    const meta1 = JSON.parse(fileContent1);
    expect(meta1.secrets.VAR_A).toBeDefined();
    expect(meta1.secrets.VAR_B).toBeDefined();

    writeFileSync(join(testRoot, '.env'), 'VAR_A=updated\n', 'utf8');
    new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['VAR_A'] }
        }
      }
    });

    const fileContent2 = fs.readFileSync(join(testRoot, 'axiomify-vault.json'), 'utf8');
    const meta2 = JSON.parse(fileContent2);
    expect(meta2.secrets.VAR_A).toBeDefined();
    expect(meta2.secrets.VAR_B).toBeUndefined();
  });

  it('should throw if loading corrupted or wrong-key vault file', () => {
    const fs = require('node:fs');
    fs.mkdirSync(join(testRoot, '.axiomify'), { recursive: true });
    fs.writeFileSync(join(testRoot, 'axiomify-vault.json'), 'corrupted-data', 'utf8');

    expect(() => new AxiomifyVault({
      projectRoot: testRoot,
    })).toThrow('[Axiomify Vault] Failed to load/decrypt vault');
  });

  it('should handle custom schema parser that throws on validation failure', () => {
    const customSchema = {
      parse: () => {
        throw new Error('Custom schema error');
      }
    };
    expect(() => new AxiomifyVault({
      projectRoot: testRoot,
      schema: customSchema,
    })).toThrow('[Axiomify Vault] Schema Validation Failed: Custom schema error');
  });

  it('should support custom schema parser that succeeds', () => {
    const customSchema = {
      parse: () => {
        return { CUSTOM_VAL: 'value' };
      }
    };
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      schema: customSchema,
    });
    expect(vault.resolveSecretJIT('CUSTOM_VAL')).toBe('value');
  });

  it('should support base64 encoded KEKs in options or environment variables', () => {
    const rawKey = require('node:crypto').randomBytes(32);
    const keyBase64 = rawKey.toString('base64');

    const vault1 = new AxiomifyVault({
      projectRoot: testRoot,
      kek: keyBase64,
      policy: {
        modules: {
          default: { allow: ['B64_TEST'] }
        }
      }
    });
    vault1.setSecret('B64_TEST', 'ok');
    expect(vault1.resolveSecret('B64_TEST')).toBe('ok');

    process.env.AXIOMIFY_VAULT_KEK = keyBase64;
    const vault2 = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['B64_TEST_ENV'] }
        }
      }
    });
    vault2.setSecret('B64_TEST_ENV', 'ok-env');
    expect(vault2.resolveSecret('B64_TEST_ENV')).toBe('ok-env');
    delete process.env.AXIOMIFY_VAULT_KEK;
  });

  it('should redact secrets from stdout and stderr write streams with various inputs', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['STDOUT_SECRET'] }
        }
      }
    });
    vault.setSecret('STDOUT_SECRET', 'my-super-secret-password-xyz');
    vault.resolveSecret('STDOUT_SECRET');

    const capturedStdout: string[] = [];
    const capturedStderr: string[] = [];

    const stdoutWriteSpy = vi.spyOn(process.stdout, '_write').mockImplementation((chunk, encoding, callback) => {
      capturedStdout.push(chunk.toString());
      callback();
    });
    const stderrWriteSpy = vi.spyOn(process.stderr, '_write').mockImplementation((chunk, encoding, callback) => {
      capturedStderr.push(chunk.toString());
      callback();
    });

    process.stdout.write('hello my-super-secret-password-xyz world');
    expect(capturedStdout.some(c => c.includes('hello •••••••• world'))).toBe(true);

    capturedStdout.length = 0;
    process.stdout.write(Buffer.from('hello my-super-secret-password-xyz world'));
    expect(capturedStdout.some(c => c.includes('hello •••••••• world'))).toBe(true);

    capturedStdout.length = 0;
    const cb = () => {};
    process.stdout.write('hello my-super-secret-password-xyz callback', cb);
    expect(capturedStdout.some(c => c.includes('hello •••••••• callback'))).toBe(true);

    process.stderr.write('error: my-super-secret-password-xyz');
    expect(capturedStderr.some(c => c.includes('error: ••••••••'))).toBe(true);

    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
  });

  it('should allow Symbol property access on process.env Proxy', () => {
    new AxiomifyVault({
      projectRoot: testRoot,
    });
    const symbolKey = Symbol('test-symbol');
    expect((process.env as any)[symbolKey]).toBeUndefined();
  });

  it('should remove secret from vault Cache and encrypted map when deleted from process.env', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['DELETABLE_SECRET'] }
        }
      }
    });
    vault.setSecret('DELETABLE_SECRET', 'temp-secret');
    expect(vault.hasSecret('DELETABLE_SECRET')).toBe(true);

    delete process.env.DELETABLE_SECRET;
    expect(vault.hasSecret('DELETABLE_SECRET')).toBe(false);
  });

  it('should get own property descriptor from process.env Proxy', () => {
    process.env.SOME_ENV_PROP = 'val';
    const desc = Object.getOwnPropertyDescriptor(process.env, 'SOME_ENV_PROP');
    expect(desc).toBeDefined();
    expect(desc?.value).toBe('val');
    delete process.env.SOME_ENV_PROP;
  });

  it('should parse caller module name from stack trace when AsyncLocalStorage is empty', () => {
    const caller1 = getCallerModuleName();
    expect(caller1).toBe('default');

    const OriginalError = globalThis.Error;
    const MockError = class extends OriginalError {
      constructor(message?: string) {
        super(message);
        this.stack = 'Error\n    at myAppModuleAction (file.js:10:5)\n    at AppModule.register (index.js:5:10)';
      }
    };
    globalThis.Error = MockError as any;

    try {
      const caller2 = getCallerModuleName();
      expect(caller2).toBe('myAppModuleAction');
    } finally {
      globalThis.Error = OriginalError;
    }
  });

  it('should default to permissive access when no policy is configured', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
    });
    expect(vault.isAllowed('any-module', 'ANY_SECRET')).toBe(true);
  });

  it('should support wildcard secret key matching in policy rules', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          'billing': { allow: ['*'] }
        }
      }
    });
    expect(vault.isAllowed('billing', 'ANY_KEY_AT_ALL')).toBe(true);
  });

  it('should throw validation errors on invalid KEK size or type', () => {
    // 1. Not a buffer
    expect(() => encrypt('test', 'not-a-buffer' as any)).toThrow('Expected a Buffer');
    expect(() => decrypt({ ciphertext: 'a', iv: 'b', tag: 'c' }, 'not-a-buffer' as any)).toThrow('Expected a Buffer');

    // 2. Wrong buffer size
    const shortBuffer = Buffer.alloc(16);
    expect(() => encrypt('test', shortBuffer)).toThrow('must be exactly 32 bytes');
    expect(() => decrypt({ ciphertext: 'a', iv: 'b', tag: 'c' }, shortBuffer)).toThrow('must be exactly 32 bytes');

    // 3. Invalid key string format / decode key failures
    expect(() => resolveKEK(testRoot, 'invalid-hex-or-base64-length-key')).toThrow('Unable to decode key string');
    
    // 4. Custom options kek buffer size validation
    expect(() => resolveKEK(testRoot, shortBuffer)).toThrow('must be exactly 32 bytes');
  });

  it('should validate loaded local key size and format', () => {
    const fs = require('node:fs');
    fs.mkdirSync(join(testRoot, '.axiomify'), { recursive: true });
    // Write an invalid 16-character hex KEK file
    fs.writeFileSync(join(testRoot, '.axiomify', 'vault.key'), '0102030405060708', 'utf8');

    expect(() => new AxiomifyVault({ projectRoot: testRoot })).toThrow('must be exactly 32 bytes');
  });

  it('should cover all process.stdout and process.stderr write branches', () => {
    new AxiomifyVault({
      projectRoot: testRoot,
    });

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    const stdoutWriteSpy = vi.fn().mockReturnValue(true);
    const stderrWriteSpy = vi.fn().mockReturnValue(true);
    process.stdout.write = stdoutWriteSpy as any;
    process.stderr.write = stderrWriteSpy as any;

    try {
      // 1. Buffer chunk
      process.stdout.write(Buffer.from('hello buffer') as any);
      process.stderr.write(Buffer.from('error buffer') as any);

      // 2. Non-string, non-buffer chunk
      process.stdout.write(123 as any);
      process.stderr.write(true as any);

      // 3. Callback with encoding
      const cb = () => {};
      process.stdout.write('hello utf8' as any, 'utf8', cb);
      process.stderr.write('error utf8' as any, 'utf8', cb);
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  });

  it('should handle stack trace parsing edge cases when stack is missing or weird', () => {
    const OriginalError = globalThis.Error;
    
    // 1. Missing stack
    const MockErrorNoStack = class extends OriginalError {
      constructor() {
        super();
        this.stack = undefined;
      }
    };
    globalThis.Error = MockErrorNoStack as any;
    try {
      expect(getCallerModuleName()).toBe('default');
    } finally {
      globalThis.Error = OriginalError;
    }

    // 2. Weird stack format (AppModule present but no 'at ')
    const MockErrorWeirdStack = class extends OriginalError {
      constructor() {
        super();
        this.stack = 'Error\n    AppModule.register (index.js:5:10)';
      }
    };
    globalThis.Error = MockErrorWeirdStack as any;
    try {
      expect(getCallerModuleName()).toBe('default');
    } finally {
      globalThis.Error = OriginalError;
    }
  });

  it('should list vault secret keys in Object.keys(process.env)', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['MY_OWN_KEYS_SECRET'] }
        }
      }
    });
    vault.setSecret('MY_OWN_KEYS_SECRET', 'my-secret-val');
    
    const keys = Object.keys(process.env);
    expect(keys).toContain('MY_OWN_KEYS_SECRET');
    
    const desc = Object.getOwnPropertyDescriptor(process.env, 'MY_OWN_KEYS_SECRET');
    expect(desc).toBeDefined();
    expect(desc?.value).toBe('••••••••');
  });

  it('should support vaultScope execution context and vault.scope method', () => {
    const result = vaultScope('payments', () => {
      return getCallerModuleName();
    });
    expect(result).toBe('payments');

    const vault = new AxiomifyVault({ projectRoot: testRoot });
    const methodResult = vault.scope('billing', () => {
      return getCallerModuleName();
    });
    expect(methodResult).toBe('billing');
  });

  it('should support listSecretKeys', () => {
    const vault = new AxiomifyVault({
      projectRoot: testRoot,
      policy: {
        modules: {
          default: { allow: ['SECRET_A', 'SECRET_B'] }
        }
      }
    });
    vault.setSecret('SECRET_A', 'a');
    vault.setSecret('SECRET_B', 'b');
    
    expect(vault.listSecretKeys()).toContain('SECRET_A');
    expect(vault.listSecretKeys()).toContain('SECRET_B');
  });

  it('should warn when vault.key is tracked by git in non-production, throw in production', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    const fs = require('node:fs');
    fs.mkdirSync(join(testRoot, '.axiomify'), { recursive: true });
    fs.writeFileSync(join(testRoot, '.axiomify', 'vault.key'), require('node:crypto').randomBytes(32).toString('hex'), 'utf8');
    
    const childProcess = require('node:child_process');
    const originalExec = childProcess.execSync;
    
    // Mock git ls-files returning successfully (tracked)
    childProcess.execSync = vi.fn().mockReturnValue(Buffer.from('tracked'));
    
    try {
      new AxiomifyVault({ projectRoot: testRoot });
      expect(consoleWarnSpy).toHaveBeenCalled();
      
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => new AxiomifyVault({ projectRoot: testRoot })).toThrow(/tracked by git/);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    } finally {
      childProcess.execSync = originalExec;
      consoleWarnSpy.mockRestore();
    }
  });
});

