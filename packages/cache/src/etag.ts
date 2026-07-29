import { createHash } from 'crypto';

export type EtagMode = 'strong' | 'weak';

/**
 * Compute an entity tag for a response payload.
 *
 * The tag is the SHA-1 digest of the payload, base64url-encoded, truncated to
 * 27 characters:
 *
 *   - SHA-1 produces 160 bits. base64url encodes 6 bits per character, so
 *     ceil(160 / 6) = 27 characters carry the **entire** digest — the
 *     "truncation" to 27 only strips base64 padding, it loses zero entropy.
 *   - SHA-1's collision weaknesses are irrelevant here: ETags are a cache
 *     revalidation optimisation, not an integrity control. An attacker who
 *     controls the response body gains nothing from an ETag collision, and
 *     SHA-1 remains meaningfully faster than SHA-256 on short payloads.
 *   - 27 base64url characters is the exact format popularised by the `etag`
 *     npm module (used by Express and Fastify), so proxies, CDNs and tooling
 *     that special-case that shape behave identically with Axiomify.
 *
 * @param body    Final response bytes (post-serialization).
 * @param mode    `'weak'` (default) emits `W/"<hash>"`; `'strong'` emits
 *                `"<hash>"`. Weak is the safe default because a strong ETag
 *                promises byte-for-byte equality, which custom serializers
 *                that embed timestamps or request-derived fields cannot keep.
 */
export function computeEtag(body: string | Buffer, mode: EtagMode = 'weak'): string {
  const hash = createHash('sha1').update(body).digest('base64url').slice(0, 27);
  return mode === 'weak' ? `W/"${hash}"` : `"${hash}"`;
}

/**
 * Extract the opaque-tag (the part between the quotes) from an entity tag,
 * dropping any `W/` weakness prefix. Used for RFC 9110 §8.8.3.2 *weak
 * comparison*: two entity tags are equivalent when their opaque-tags match
 * character-by-character, regardless of either or both being weak.
 */
function opaqueTag(tag: string): string {
  let t = tag.trim();
  if (t.startsWith('W/') || t.startsWith('w/')) t = t.slice(2);
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    t = t.slice(1, -1);
  }
  return t;
}

/**
 * Parse an `If-None-Match` header value into its member entity tags.
 *
 * Handles, per RFC 9110 §8.8.3 / §13.1.2:
 *   - the special value `*`
 *   - comma-separated lists of entity tags
 *   - `W/` weakness prefixes
 *   - commas *inside* quoted opaque-tags (the etagc grammar permits `,`)
 *   - lenient fallback for non-compliant unquoted tokens sent by some clients
 */
export function parseIfNoneMatch(value: string): string[] {
  const tags: string[] = [];
  let i = 0;
  const len = value.length;
  while (i < len) {
    const ch = value[i];
    // Skip list separators and optional whitespace.
    if (ch === ',' || ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '*') {
      tags.push('*');
      i++;
      continue;
    }
    // Optional weakness prefix.
    const start = i;
    if ((ch === 'W' || ch === 'w') && value[i + 1] === '/') {
      i += 2;
    }
    if (value[i] === '"') {
      // Quoted opaque-tag — scan to the closing DQUOTE. Commas are legal
      // inside per the etagc grammar, so a naive split(',') would be wrong.
      const close = value.indexOf('"', i + 1);
      if (close === -1) {
        // Unterminated quote — take the rest as a lenient token.
        tags.push(value.slice(start).trim());
        break;
      }
      tags.push(value.slice(start, close + 1));
      i = close + 1;
    } else {
      // Lenient: unquoted token until the next comma or whitespace.
      let end = i;
      while (end < len && value[end] !== ',' && value[end] !== ' ' && value[end] !== '\t') {
        end++;
      }
      tags.push(value.slice(start, end));
      i = end;
    }
  }
  return tags;
}

/**
 * RFC 9110 §13.1.2 `If-None-Match` evaluation against a single current ETag,
 * using **weak comparison** (§8.8.3.2) as the spec mandates for this header.
 *
 * @returns `true` when the condition FAILS — i.e. the recipient MUST NOT
 *          perform the method and should answer 304 for GET/HEAD.
 */
export function ifNoneMatchMatches(
  headerValue: string | string[] | undefined,
  etag: string | undefined,
): boolean {
  if (headerValue === undefined || headerValue === null) return false;
  const raw = Array.isArray(headerValue) ? headerValue.join(', ') : headerValue;
  if (raw.trim() === '') return false;
  const candidates = parseIfNoneMatch(raw);
  if (candidates.includes('*')) {
    // `*` matches any current representation; the caller only evaluates this
    // when it is about to emit one, so a representation always exists here.
    return true;
  }
  if (!etag) return false;
  const current = opaqueTag(etag);
  for (const candidate of candidates) {
    if (opaqueTag(candidate) === current) return true;
  }
  return false;
}
