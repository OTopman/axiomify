import { describe, expect, it, vi, afterEach } from 'vitest';
import { defaultLogger, ADAPTER_LOCK_TOKEN } from '../src/internal';

describe('Core internal structures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should support defaultLogger methods', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    defaultLogger.info('info msg', { foo: 'bar' });
    expect(logSpy).toHaveBeenCalledWith('info msg', { foo: 'bar' });

    defaultLogger.warn('warn msg');
    expect(warnSpy).toHaveBeenCalledWith('warn msg', '');

    defaultLogger.error('error msg');
    expect(errorSpy).toHaveBeenCalledWith('error msg', '');

    defaultLogger.fatal!('fatal msg');
    expect(errorSpy).toHaveBeenLastCalledWith('fatal msg', '');

    defaultLogger.debug!('debug msg');
    expect(debugSpy).toHaveBeenCalledWith('debug msg', '');

    defaultLogger.trace!('trace msg');
    expect(debugSpy).toHaveBeenLastCalledWith('trace msg', '');
  });

  it('should have a frozen ADAPTER_LOCK_TOKEN', () => {
    expect(Object.isFrozen(ADAPTER_LOCK_TOKEN)).toBe(true);
    expect(ADAPTER_LOCK_TOKEN._brand).toBe('axiomify.adapter.v2');
  });
});
