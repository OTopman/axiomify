/**
 * Regression tests for CWE-80 / CWE-116 — single-pass regex bypass.
 *
 * Each test proves that a crafted input that would survive a single-pass
 * replacement is fully neutralised by the loop-until-stable strategy.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeInput } from '../src/utils/sanitizer';

function xss(input: string): string {
  return sanitizeInput(input, {
    xssProtection: true,
    nullByteProtection: true,
    prototypePollutionProtection: false,
  }) as string;
}

describe('sanitizeXss — single-pass bypass regression (CWE-80)', () => {
  // ── <script> bypass ──────────────────────────────────────────────────────
  it('removes a plain script tag', () => {
    expect(xss('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('removes nested <script> bypass: <scrip<script>t>…</script>', () => {
    // Single-pass left: <script>alert(1)</script>
    // Loop removes it completely.
    const payload = '<scrip<script>is removed</script>t>alert(1)</script>';
    const result = xss(payload);
    expect(result).not.toMatch(/<script/i);
    expect(result).not.toContain('alert(1)');
  });

  it('removes double-nested script bypass', () => {
    // <<script>script> survives one pass as <script>
    const payload = '<<script>script>alert(2)<</script>/script>';
    const result = xss(payload);
    expect(result).not.toMatch(/<script/i);
  });

  it('removes script tag with attributes', () => {
    const payload = '<script src="evil.js" type="text/javascript"></script>';
    expect(xss(payload)).not.toMatch(/<script/i);
  });

  it('removes script tag with spaces or attributes in end tag (CWE-80 / js/bad-tag-filter)', () => {
    expect(xss('<script>alert(1)</script >')).not.toContain('alert(1)');
    expect(xss('<script>alert(1)</script foo="bar">')).not.toContain('alert(1)');
    expect(xss('<script>alert(1)</script/nested>')).not.toContain('alert(1)');
    expect(xss('<scrip<script>is removed</script >t>alert(1)</script foo="bar">')).not.toContain('alert(1)');
  });

  // ── javascript: bypass ───────────────────────────────────────────────────
  it('removes a plain javascript: URI', () => {
    expect(xss('javascript:alert(1)')).not.toMatch(/javascript:/i);
  });

  it('removes nested javascript: bypass: jajavascript:vascript:', () => {
    // Single-pass removes the inner "javascript:" leaving "javascript:"
    // Loop removes it completely.
    const payload = 'href="jajavascript:vascript:alert(1)"';
    const result = xss(payload);
    expect(result).not.toMatch(/javascript:/i);
  });

  it('removes whitespace-padded javascript: bypass', () => {
    // j a v a s c r i p t :
    const payload = 'j a v a s c r i p t :alert(1)';
    expect(xss(payload)).not.toMatch(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i);
  });

  // ── data: bypass ─────────────────────────────────────────────────────────
  it('removes a plain data: URI', () => {
    expect(xss('<img src="data:text/html,<h1>xss</h1>">')).not.toMatch(/data:/i);
  });

  it('removes nested data: bypass: ddata:ata:', () => {
    const payload = 'ddata:ata:text/html,<script>alert(1)</script>';
    const result = xss(payload);
    expect(result).not.toMatch(/data:/i);
  });

  // ── on* event handler bypass ─────────────────────────────────────────────
  it('removes inline event handlers', () => {
    expect(xss('<img onerror=alert(1)>')).not.toMatch(/\bon\w+\s*=/i);
  });

  it('removes nested on* bypass: ononclick=click=', () => {
    // Single-pass on "ononclick=" removes inner "onclick=" leaving "on="
    // which is NOT matched. Loop: "ononclick=" → "on=" which has no \w+.
    // Actually "ononclick=" → after replacing /\bon\w+\s*=/ → "on=" since
    // \b matches before 'o', \w+ matches 'nonclick'. Let me verify this is
    // the actual bypass vector.
    // Correct bypass: <img oononclick=click==alert(1)>
    const payload = '<img oononclick=click=alert(1)>';
    const result = xss(payload);
    expect(result).not.toMatch(/\bon\w+\s*=/i);
  });

  // ── <iframe> / <object> / <embed> / <base> bypass ────────────────────────
  it('removes plain iframe', () => {
    expect(xss('<iframe src="evil.com"></iframe>')).not.toMatch(/<iframe/i);
  });

  it('removes nested iframe bypass: <ifr<iframe>ame …>', () => {
    const payload = '<ifr<iframe src="x">ame src="evil.com"></iframe>';
    const result = xss(payload);
    expect(result).not.toMatch(/<iframe/i);
  });

  it('removes <object>, <embed>, and <base> tags', () => {
    expect(xss('<object data="evil"></object>')).not.toMatch(/<object/i);
    expect(xss('<embed src="evil">')).not.toMatch(/<embed/i);
    expect(xss('<base href="//evil.com">')).not.toMatch(/<base/i);
  });

  // ── <svg> bypass ─────────────────────────────────────────────────────────
  it('removes a plain svg tag', () => {
    expect(xss('<svg onload=alert(1)></svg>')).not.toMatch(/<svg/i);
  });

  it('removes nested svg bypass: <<svg>svg onload=…>', () => {
    const payload = '<<svg>svg onload=alert(1)><</svg>/svg>';
    const result = xss(payload);
    expect(result).not.toMatch(/<svg/i);
  });

  // ── null bytes ───────────────────────────────────────────────────────────
  it('strips null bytes', () => {
    expect(xss('hello\0world')).not.toContain('\0');
  });

  // ── safe content is preserved ─────────────────────────────────────────────
  it('does not corrupt safe plain text', () => {
    expect(xss('Hello, world!')).toBe('Hello, world!');
  });

  it('does not corrupt safe HTML entities', () => {
    // Entities like &amp; are not tags — should survive
    const input = '&lt;b&gt;bold&lt;/b&gt;';
    expect(xss(input)).toBe(input);
  });
});

describe('sanitizeInput — object and array recursion', () => {
  it('sanitizes nested object values', () => {
    const result = sanitizeInput({ user: { bio: '<script>alert(1)</script>' } }) as any;
    expect(result.user.bio).not.toMatch(/<script/i);
  });

  it('sanitizes array elements', () => {
    const result = sanitizeInput(['<script>x</script>', 'safe']) as string[];
    expect(result[0]).not.toMatch(/<script/i);
    expect(result[1]).toBe('safe');
  });

  it('strips prototype pollution keys', () => {
    const input = { name: 'Ada', __proto__: { polluted: true }, constructor: { bad: true } } as any;
    const result = sanitizeInput(input) as any;
    expect(result.__proto__).toBeUndefined();
    expect(result.constructor).toBeUndefined();
    expect(result.name).toBe('Ada');
  });

  it('returns undefined for depth-exceeded values', () => {
    // Build an object 70 levels deep — exceeds default maxDepth of 64
    let deep: any = { value: 'bottom' };
    for (let i = 0; i < 70; i++) deep = { child: deep };
    const result = sanitizeInput(deep) as any;
    // The deeply nested 'value' should be undefined (depth exceeded)
    let node = result;
    for (let i = 0; i < 70; i++) node = node?.child;
    expect(node).toBeUndefined();
  });

  it('passes non-string primitives through unchanged', () => {
    expect(sanitizeInput(42)).toBe(42);
    expect(sanitizeInput(true)).toBe(true);
    expect(sanitizeInput(null)).toBeNull();
  });

  it('preserves native object types like Date and Buffer without corrupting them', () => {
    const d = new Date();
    const b = Buffer.from('hello');
    expect(sanitizeInput(d)).toBe(d);
    expect(sanitizeInput(b)).toBe(b);
  });
});

describe('sanitizeInput — disabled protections', () => {
  it('preserves null bytes when nullByteProtection is false', () => {
    const result = sanitizeInput('a\0b', {
      xssProtection: false,
      prototypePollutionProtection: false,
      nullByteProtection: false,
      maxDepth: 64,
    });
    expect(result).toBe('a\0b');
  });

  it('preserves raw HTML when xssProtection is false', () => {
    const result = sanitizeInput('<script>x</script>', {
      xssProtection: false,
      prototypePollutionProtection: false,
      nullByteProtection: true,
      maxDepth: 64,
    });
    expect(result).toBe('<script>x</script>');
  });
});
