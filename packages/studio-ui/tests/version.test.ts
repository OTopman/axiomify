import { describe, expect, it } from 'vitest';
import workspacePackage from '../../../package.json';
import viteConfig from '../vite.config';

describe('Studio version badge', () => {
  it('embeds the current workspace release version in the UI build', () => {
    const define = (viteConfig as { define?: Record<string, string> }).define;
    expect(define?.['import.meta.env.VITE_AXIOMIFY_VERSION']).toBe(
      JSON.stringify(workspacePackage.version),
    );
    expect(workspacePackage.version).toBe('7.1.0');
  });
});
