import { AsyncLocalStorage } from 'node:async_hooks';
import type { AxiomifyVault } from './index';

export const vaultContext = new AsyncLocalStorage<string>();
if (!(globalThis as any)._axiomifyVaultContext) {
  (globalThis as any)._axiomifyVaultContext = vaultContext;
}

/**
 * Wraps `fn` in the Vault ABAC AsyncLocalStorage context for `moduleName`.
 */
export function vaultScope<T>(moduleName: string, fn: () => T): T {
  return vaultContext.run(moduleName, fn);
}

/**
 * Instance-scoped set of plaintext secrets used for redaction.
 * Shared across vault instances via the stream sanitizer.
 */
const activePlaintextSecrets = new Set<string>();
let _cachedRedactionRegex: RegExp | null = null;
let isSanitizerSetup = false;

/**
 * Invalidates the cached redaction regex so it is rebuilt on next use.
 */
function invalidateRedactionRegex(): void {
  _cachedRedactionRegex = null;
}

/**
 * Builds or returns a cached regex that matches all registered secrets in a single pass.
 */
function getRedactionRegex(): RegExp | null {
  if (_cachedRedactionRegex) return _cachedRedactionRegex;
  if (activePlaintextSecrets.size === 0) return null;

  const escaped = Array.from(activePlaintextSecrets).map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  _cachedRedactionRegex = new RegExp(escaped.join('|'), 'g');
  return _cachedRedactionRegex;
}

/**
 * Registers a plaintext secret value so that it is redacted from all stdout/stderr streams.
 */
export function registerSecretForRedaction(secret: string): void {
  if (secret && secret.length >= 4) {
    if (!activePlaintextSecrets.has(secret)) {
      activePlaintextSecrets.add(secret);
      invalidateRedactionRegex();
    }
  }
}

/**
 * Unregisters a plaintext secret value from the redaction set.
 * Used during secret rotation to remove the old value.
 */
export function unregisterSecretForRedaction(secret: string): void {
  if (activePlaintextSecrets.delete(secret)) {
    invalidateRedactionRegex();
  }
}

/**
 * Wraps stdout and stderr write streams to dynamically redact registered secrets.
 * Uses a compiled regex for single-pass O(1) pattern matching instead of per-secret iteration.
 */
export function setupStreamSanitizer(): void {
  if (isSanitizerSetup) return;
  isSanitizerSetup = true;

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  function redact(str: string): string {
    const regex = getRedactionRegex();
    if (!regex) return str;
    // Reset lastIndex for global regex reuse
    regex.lastIndex = 0;
    return str.replace(regex, '••••••••');
  }

  process.stdout.write = function (
    chunk: any,
    encodingOrCallback?: any,
    callback?: any,
  ): boolean {
    const encoding =
      typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const cb =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;

    const str =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);
    const sanitized = redact(str);

    return originalStdoutWrite.call(
      process.stdout,
      sanitized,
      encoding as any,
      cb,
    );
  } as any;

  process.stderr.write = function (
    chunk: any,
    encodingOrCallback?: any,
    callback?: any,
  ): boolean {
    const encoding =
      typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const cb =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;

    const str =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);
    const sanitized = redact(str);

    return originalStderrWrite.call(
      process.stderr,
      sanitized,
      encoding as any,
      cb,
    );
  } as any;
}

const originalEnv = (process as any).__originalEnv || process.env;
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

    set(target, prop, value) {
      if (typeof prop === 'string' && vault.hasSecret(prop)) {
        vault.rotateSecret(prop, String(value));
      }
      return Reflect.set(target, prop, value);
    },

    deleteProperty(target, prop) {
      if (typeof prop === 'string' && vault.hasSecret(prop)) {
        // Use public API instead of reaching into private fields
        vault.removeSecret(prop);
      }
      return Reflect.deleteProperty(target, prop);
    },

    ownKeys(target) {
      const envKeys = Reflect.ownKeys(currentEnv);
      const vaultKeys = vault.listSecretKeys();
      return Array.from(new Set([...envKeys, ...vaultKeys]));
    },

    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && vault.hasSecret(prop)) {
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: '••••••••',
        };
      }
      return Reflect.getOwnPropertyDescriptor(currentEnv, prop);
    },
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

  // Best-effort fallback: parse stack trace for module context.
  // This is fragile and depends on V8 stack format. AsyncLocalStorage is the primary mechanism.
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

/**
 * Sentinel returned for callers that cannot be confidently identified.
 * Deliberately distinct from 'default' so that a policy granting the
 * 'default' module does not implicitly grant unidentified callers (CWE-807).
 */
export const UNKNOWN_CALLER = 'unknown';

/**
 * Resolves the caller module name for security-sensitive policy checks.
 *
 * If an ALS context is present, its value is used (unchanged behavior).
 * Otherwise, stack parsing is attempted; if it yields no confident module
 * match, {@link UNKNOWN_CALLER} is returned instead of 'default', so that
 * unidentified callers are not implicitly granted a 'default' policy.
 */
export function resolveConfidentCallerModuleName(): string {
  const store = vaultContext.getStore();
  if (store) return store;

  const stack = new Error().stack ?? '';
  const lines = stack.split('\n');
  for (const line of lines) {
    if (line.includes('AppModule') || line.includes('AppConfigurator')) {
      const match = line.match(/at\s+([a-zA-Z0-9_$]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  return UNKNOWN_CALLER;
}
