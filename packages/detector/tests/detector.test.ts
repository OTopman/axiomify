import { describe, expect, it } from 'vitest';
import {
  detectNoSqlInjection,
  detectSqlInjection,
  isSuspiciousUserAgent,
} from '../src';

describe('detector', () => {
  it('detects SQL payloads', () => {
    expect(detectSqlInjection("1 UNION SELECT * FROM users")).toBe(true);
  });

  it('detects NoSQL operator keys', () => {
    expect(detectNoSqlInjection({ where: { $ne: null } })).toBe(true);
  });

  it('detects suspicious scanner user agents', () => {
    expect(isSuspiciousUserAgent('sqlmap/1.8.4')).toBe(true);
    expect(isSuspiciousUserAgent('Mozilla/5.0')).toBe(false);
  });
});
