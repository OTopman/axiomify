import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSdk } from '../../src/commands/sdk/generate';

describe('SDK Generation CLI Command', () => {
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with ${code}`);
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject output directory outside project root when exitOnError is false', async () => {
    const success = await generateSdk({
      input: 'valid.json',
      target: ['typescript'],
      output: '../outside-directory',
      exitOnError: false,
    });

    expect(success).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(
      'must be contained within the project root directory',
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should call process.exit(1) on output directory outside project root by default', async () => {
    await expect(
      generateSdk({
        input: 'valid.json',
        target: ['typescript'],
        output: '/absolute/path/outside',
      }),
    ).rejects.toThrow('process.exit called with 1');

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(
      'must be contained within the project root directory',
    );
  });

  it('should permit output directory inside project root', async () => {
    // We expect it to try reading the input file (ingestion step) and fail because the file doesn't exist.
    // This confirms it passed the containment check and proceeded to the ingestion step.
    const success = await generateSdk({
      input: 'nonexistent-input-file.json',
      target: ['typescript'],
      output: './inside-directory',
      exitOnError: false,
    });

    expect(success).toBe(false);
    // It should have logged "Ingestion failed" because the input file doesn't exist.
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('Ingestion failed');
    expect(consoleErrorSpy.mock.calls[0][0]).not.toContain(
      'must be contained within the project root directory',
    );
  });
});
