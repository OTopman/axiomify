/**
 * Vault proxy shim for @axiomify/core.
 *
 * This module is required at runtime by app.ts when a vault is registered.
 * It provides the vaultScope() function that wraps any callable in the correct
 * AsyncLocalStorage context so Vault ABAC policy checks work at request time.
 *
 * This shim uses a conditional require so that @axiomify/core does not need a
 * hard runtime dependency on @axiomify/vault. If vault is not installed, the
 * shim falls back to a passthrough (no-op) implementation.
 *
 * Why a shim file rather than a direct import?
 *   - @axiomify/core must not list @axiomify/vault as a required dependency
 *     (not all users install vault).
 *   - A dynamic require() lets Node resolve vault when present and gracefully
 *     degrade when absent, without TypeScript seeing a broken import path.
 */

let _vaultScope: ((moduleName: string, fn: () => any) => any) | null = null;

try {
  // Try to load vaultScope from @axiomify/vault if available.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vaultProxy = require('@axiomify/vault');
  if (typeof vaultProxy.vaultScope === 'function') {
    _vaultScope = vaultProxy.vaultScope;
  }
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vaultProxy = require('@axiomify/vault/proxy');
    if (typeof vaultProxy.vaultScope === 'function') {
      _vaultScope = vaultProxy.vaultScope;
    }
  } catch {
    // @axiomify/vault not installed — use passthrough
  }
}

/**
 * Wraps `fn` in the Vault ABAC AsyncLocalStorage context for `moduleName`.
 * If @axiomify/vault is not installed, `fn` is called directly.
 */
export function vaultScope<T>(moduleName: string, fn: () => T): T {
  if (_vaultScope) {
    return _vaultScope(moduleName, fn) as T;
  }
  return fn();
}
