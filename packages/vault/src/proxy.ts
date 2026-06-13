import { AsyncLocalStorage } from 'node:async_hooks';
import { AxiomifyVault } from './index';

export const vaultContext = new AsyncLocalStorage<string>();
(globalThis as any)._axiomifyVaultContext = vaultContext;

const activePlaintextSecrets = new Set<string>();
let isSanitizerSetup = false;

/**
 * Registers a plaintext secret value so that it is redacted from all stdout/stderr streams.
 */
export function registerSecretForRedaction(secret: string): void {
  if (secret && secret.length >= 4) {
    activePlaintextSecrets.add(secret);
  }
}

/**
 * Wraps stdout and stderr write streams to dynamically redact registered secrets.
 */
export function setupStreamSanitizer(): void {
  if (isSanitizerSetup) return;
  isSanitizerSetup = true;

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  function redact(str: string): string {
    let sanitized = str;
    for (const secret of activePlaintextSecrets) {
      sanitized = sanitized.replaceAll(secret, '••••••••');
    }
    return sanitized;
  }

  process.stdout.write = function (
    chunk: any,
    encodingOrCallback?: any,
    callback?: any
  ): boolean {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;

    const str = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const sanitized = redact(str);

    return originalStdoutWrite.call(process.stdout, sanitized, encoding as any, cb);
  } as any;

  process.stderr.write = function (
    chunk: any,
    encodingOrCallback?: any,
    callback?: any
  ): boolean {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;

    const str = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const sanitized = redact(str);

    return originalStderrWrite.call(process.stderr, sanitized, encoding as any, cb);
  } as any;
}

let originalEnv = (process as any).__originalEnv || process.env;
if (!(process as any).__originalEnv) {
  (process as any).__originalEnv = originalEnv;
}

export function restoreProcessEnv(): void {
  Object.defineProperty(process, 'env', {
    value: (process as any).__originalEnv,
    writable: true,
    configurable: true,
  });
}

/**
 * Overrides process.env with a proxy that intercept accesses, masking secrets by default.
 */
export function setupProcessEnvProxy(vault: AxiomifyVault): void {
  restoreProcessEnv();
  const currentEnv = (process as any).__originalEnv;

  const handler: ProxyHandler<NodeJS.ProcessEnv> = {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }

      // Check if it's a sensitive vault key
      if (vault.hasSecret(prop)) {
        // Enforce default policy check or return masked value if requested generically
        // To allow direct JIT retrieval under target module rules:
        const callerName = getCallerModuleName();
        if (vault.isAllowed(callerName, prop)) {
          const secret = vault.resolveSecretJIT(prop);
          registerSecretForRedaction(secret);
          return secret;
        }
        return '••••••••';
      }

      return Reflect.get(currentEnv, prop, receiver);
    },

    set(target, prop, value, receiver) {
      if (typeof prop === 'string' && vault.hasSecret(prop)) {
        vault.rotateSecret(prop, String(value));
      }
      return Reflect.set(target, prop, value, receiver);
    },

    deleteProperty(target, prop) {
      if (typeof prop === 'string' && vault.hasSecret(prop)) {
        (vault as any).secretsCache.delete(prop);
        (vault as any).encryptedSecrets.delete(prop);
      }
      return Reflect.deleteProperty(target, prop);
    },

    ownKeys(target) {
      return Reflect.ownKeys(currentEnv);
    },

    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(currentEnv, prop);
    }
  };

  const envProxy = new Proxy(currentEnv, handler);
  Object.defineProperty(process, 'env', {
    value: envProxy,
    writable: false,
    configurable: true,
  });
}

export function getCallerModuleName(): string {
  const store = vaultContext.getStore();
  if (store) return store;

  const stack = new Error().stack ?? '';
  const lines = stack.split('\n');
  
  // Find a line corresponding to module registration or module lifecycle
  for (const line of lines) {
    if (line.includes('AppModule') || line.includes('AppConfigurator')) {
      const match = line.match(/at\s+([a-zA-Z0-9_$]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  return 'default';
}
