import { describe, expect, it, vi } from 'vitest';
import Module from 'node:module';

describe('vault-proxy-shim fallback', () => {
  it('should fall back to `@axiomify/vault/proxy` if `@axiomify/vault` is not installed', async () => {
    vi.resetModules();

    // Reset require cache for the shim module to ensure it gets re-evaluated
    const shimPath = require.resolve('../src/vault-proxy-shim.ts');
    delete require.cache[shimPath];

    const mockVaultScope = vi.fn((name, fn) => fn());
    const originalRequire = Module.prototype.require;

    Module.prototype.require = function (id: string, ...args: any[]) {
      if (id === '@axiomify/vault') {
        throw new Error('module not found');
      }
      if (id === '@axiomify/vault/proxy') {
        return { vaultScope: mockVaultScope };
      }
      return originalRequire.apply(this, [id, ...args] as any);
    };

    try {
      const { vaultScope } = await import('../src/vault-proxy-shim.ts');
      const result = vaultScope('fallback-to-proxy', () => 456);
      expect(result).toBe(456);
      expect(mockVaultScope).toHaveBeenCalledWith(
        'fallback-to-proxy',
        expect.any(Function),
      );
    } finally {
      Module.prototype.require = originalRequire;
    }
  });

  it('should fall back to passthrough if vault is not installed', async () => {
    vi.resetModules();

    // Reset require cache for the shim module to ensure it gets re-evaluated
    const shimPath = require.resolve('../src/vault-proxy-shim.ts');
    delete require.cache[shimPath];

    const originalRequire = Module.prototype.require;

    Module.prototype.require = function (id: string, ...args: any[]) {
      if (id === '@axiomify/vault' || id === '@axiomify/vault/proxy') {
        throw new Error('module not found');
      }
      return originalRequire.apply(this, [id, ...args] as any);
    };

    try {
      const { vaultScope } = await import('../src/vault-proxy-shim.ts');
      let called = false;
      const result = vaultScope('test', () => {
        called = true;
        return 123;
      });
      expect(called).toBe(true);
      expect(result).toBe(123);
    } finally {
      Module.prototype.require = originalRequire;
    }
  });
});
