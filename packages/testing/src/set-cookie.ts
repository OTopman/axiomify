/**
 * Structured representation of a single `Set-Cookie` response header line.
 */
export interface ParsedSetCookie {
  name: string;
  /** URI-decoded cookie value (quoted values are unquoted per RFC 6265). */
  value: string;
  path?: string;
  domain?: string;
  expires?: Date;
  /** `Max-Age` in seconds. */
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  /** CHIPS `Partitioned` flag. */
  partitioned: boolean;
  /** `Priority=` attribute (Chrome extension). */
  priority?: 'low' | 'medium' | 'high';
}

/**
 * Parse a `Set-Cookie` header line into a {@link ParsedSetCookie}.
 *
 * Mirrors how browsers read the header: the first `name=value` pair is the
 * cookie itself, every following `;`-separated segment is an attribute.
 * Unknown attributes are ignored; malformed `Expires`/`Max-Age` values are
 * dropped rather than throwing.
 */
export function parseSetCookie(line: string): ParsedSetCookie {
  const segments = line.split(';');
  const pair = segments[0] ?? '';
  const eq = pair.indexOf('=');
  const name = (eq === -1 ? pair : pair.slice(0, eq)).trim();
  let value = eq === -1 ? '' : pair.slice(eq + 1).trim();

  if (
    value.length >= 2 &&
    value.charCodeAt(0) === 34 /* " */ &&
    value.charCodeAt(value.length - 1) === 34
  ) {
    value = value.slice(1, -1);
  }
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* malformed encoding — keep raw value, same policy as core */
    }
  }

  const cookie: ParsedSetCookie = {
    name,
    value,
    httpOnly: false,
    secure: false,
    partitioned: false,
  };

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const attrEq = segment.indexOf('=');
    const key = (attrEq === -1 ? segment : segment.slice(0, attrEq))
      .trim()
      .toLowerCase();
    const val = attrEq === -1 ? '' : segment.slice(attrEq + 1).trim();

    switch (key) {
      case 'path':
        cookie.path = val;
        break;
      case 'domain':
        cookie.domain = val;
        break;
      case 'expires': {
        const date = new Date(val);
        if (!Number.isNaN(date.getTime())) cookie.expires = date;
        break;
      }
      case 'max-age': {
        const n = Number(val);
        if (Number.isFinite(n)) cookie.maxAge = n;
        break;
      }
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'samesite': {
        const v = val.toLowerCase();
        if (v === 'strict' || v === 'lax' || v === 'none') cookie.sameSite = v;
        break;
      }
      case 'partitioned':
        cookie.partitioned = true;
        break;
      case 'priority': {
        const v = val.toLowerCase();
        if (v === 'low' || v === 'medium' || v === 'high') cookie.priority = v;
        break;
      }
    }
  }
  return cookie;
}
