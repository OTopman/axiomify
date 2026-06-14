import { describe, expect, it, vi } from 'vitest';

describe('vault-proxy-shim fallback', () => {
  it('should fall back to passthrough if vault is not installed', async () => {
    vi.resetModules();
    vi.doMock('@axiomify/vault', () => {
      throw new Error('module not found');
    });
    vi.doMock('@axiomify/vault/proxy', () => {
      throw new Error('module not found');
    });

    const { vaultScope } = await import('../src/vault-proxy-shim');
    let called = false;
    const result = vaultScope('test', () => {
      called = true;
      return 123;
    });
    expect(called).toBe(true);
    expect(result).toBe(123);
  });
});
