import { describe, it, expect } from 'vitest';
import { colourMethod, visibleLength, pluralise, symbols } from '../src/utils/format';
import pc from 'picocolors';

describe('CLI Utilities', () => {
  it('should colour HTTP methods', () => {
    const get = colourMethod('GET');
    expect(get).toContain('GET');
    expect(get).not.toBe('GET'); // should have ansi codes
  });

  it('should calculate visible length correctly', () => {
    const styled = pc.bold(pc.red('Hello'));

    expect(visibleLength(styled)).toBe(5);
  });

  it('should pluralise correctly', () => {
    expect(pluralise(1, 'apple')).toBe('1 apple');
    expect(pluralise(2, 'apple')).toBe('2 apples');
    expect(pluralise(0, 'apple')).toBe('0 apples');
  });

  it('should export standard symbols', () => {
    expect(symbols.ok).toContain('✓');
    expect(symbols.fail).toContain('✗');
  });
});
