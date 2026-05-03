import type { HttpMethod, RouteDefinition } from './types';

interface RoutePayload {
  definition: RouteDefinition;
  /** Param key names in order of appearance in the path. */
  paramKeys: string[];
}

export type RouterLookupResult =
  | { route: RouteDefinition; params: Record<string, string> }
  | { error: 'MethodNotAllowed'; allowed: HttpMethod[] }
  | null;

// ─── Trie node ────────────────────────────────────────────────────────────────

class TrieNode {
  /** Static segment children. Key is the literal segment string. */
  public children = new Map<string, TrieNode>();
  /**
   * Named parameter children.
   * Key is the param name (without `:`) so we never re-slice at lookup time.
   */
  public paramChildren: Array<{ key: string; node: TrieNode }> = [];
  public wildcardChild: TrieNode | null = null;
  public routes = new Map<HttpMethod, RoutePayload>();
}

// ─── Pre-allocated param accumulator ─────────────────────────────────────────
//
// The recursive lookup previously spread params into a new array on every
// matched segment: `[...params, [key, value]]`. For a 2-param route that's
// 2 intermediate array allocations per lookup.
//
// Instead we pass a single flat reusable array (keys and values interleaved)
// and a length counter through the recursion. The output `Record<string,string>`
// is built only once at the end, from the flat array.

interface ParamAccum {
  keys: string[];
  vals: string[];
  len: number;
}

function makeParamAccum(capacity = 8): ParamAccum {
  return { keys: new Array(capacity), vals: new Array(capacity), len: 0 };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export class Router {
  private root = new TrieNode();

  // ── Registration ────────────────────────────────────────────────────────────

  public register(route: RouteDefinition): void {
    const paramKeys: string[] = [];
    let node = this.root;
    let start = route.path.startsWith('/') ? 1 : 0;
    const path = route.path;

    // Walk the path character-by-character to extract segments without
    // allocating a temporary string[]. Only allocate one string per segment.
    while (start <= path.length) {
      let end = path.indexOf('/', start);
      if (end === -1) end = path.length;

      const seg = path.slice(start, end);

      if (seg.startsWith(':')) {
        const key = seg.slice(1);
        paramKeys.push(key);
        let found: TrieNode | undefined;
        for (const entry of node.paramChildren) {
          if (entry.key === key) { found = entry.node; break; }
        }
        if (!found) {
          found = new TrieNode();
          node.paramChildren.push({ key, node: found });
        }
        node = found;
      } else if (seg === '*') {
        if (end !== path.length) {
          throw new Error(
            `Invalid route "${route.path}": wildcard * must be the final path segment.`,
          );
        }
        if (!node.wildcardChild) node.wildcardChild = new TrieNode();
        node = node.wildcardChild;
      } else {
        let child = node.children.get(seg);
        if (!child) { child = new TrieNode(); node.children.set(seg, child); }
        node = child;
      }

      start = end + 1;
    }

    if (node.routes.has(route.method)) {
      throw new Error(
        `Route collision: ${route.method} ${route.path} is already registered.`,
      );
    }
    node.routes.set(route.method, { definition: route, paramKeys });
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  /**
   * Looks up an incoming request. Returns:
   * - `{ route, params }` on match
   * - `{ error: 'MethodNotAllowed', allowed }` when path matches but method doesn't
   * - `null` on 404
   *
   * The path MUST NOT include a query string — strip it before calling.
   */
  public lookup(method: HttpMethod, path: string): RouterLookupResult {
    const accum = makeParamAccum();
    const match = this._lookupNode(this.root, path, path.startsWith('/') ? 1 : 0, method, accum);
    if (match) return match;

    const allowed = this._collectAllowed(this.root, path, path.startsWith('/') ? 1 : 0);
    if (allowed.length > 0) {
      if (allowed.includes('GET') && !allowed.includes('HEAD')) allowed.push('HEAD');
      return { error: 'MethodNotAllowed', allowed };
    }
    return null;
  }

  private _lookupNode(
    node: TrieNode,
    path: string,
    pos: number,
    method: HttpMethod,
    accum: ParamAccum,
  ): { route: RouteDefinition; params: Record<string, string> } | null {
    // ── End of path: try to match a route ───────────────────────────────────
    if (pos > path.length) {
      let payload = node.routes.get(method);
      if (!payload && method === 'HEAD') payload = node.routes.get('GET');
      if (!payload) return null;

      // Build output params object only once, from the flat accumulator.
      const params: Record<string, string> = {};
      const { paramKeys } = payload;
      // paramKeys are in registration order; accum.keys/vals are in traversal order
      for (let i = 0; i < accum.len; i++) {
        params[accum.keys[i]] = accum.vals[i];
      }
      return { route: payload.definition, params };
    }

    // ── Find next segment end ────────────────────────────────────────────────
    let end = path.indexOf('/', pos);
    if (end === -1) end = path.length;
    const seg = path.slice(pos, end);
    const nextPos = end === path.length ? end + 1 : end + 1;

    // ── Static child (fastest path) ─────────────────────────────────────────
    const staticChild = node.children.get(seg);
    if (staticChild) {
      const match = this._lookupNode(staticChild, path, nextPos, method, accum);
      if (match) return match;
    }

    // ── Named param children ─────────────────────────────────────────────────
    const savedLen = accum.len;
    for (const { key, node: paramNode } of node.paramChildren) {
      accum.keys[accum.len] = key;
      accum.vals[accum.len] = seg;
      accum.len = savedLen + 1;
      const match = this._lookupNode(paramNode, path, nextPos, method, accum);
      if (match) return match;
      accum.len = savedLen; // backtrack
    }

    // ── Wildcard ─────────────────────────────────────────────────────────────
    if (node.wildcardChild) {
      accum.keys[accum.len] = '*';
      accum.vals[accum.len] = path.slice(pos);
      accum.len = savedLen + 1;
      const match = this._lookupNode(node.wildcardChild, path, path.length + 1, method, accum);
      if (match) return match;
      accum.len = savedLen;
    }

    return null;
  }

  private _collectAllowed(node: TrieNode, path: string, pos: number): HttpMethod[] {
    if (pos > path.length) return Array.from(node.routes.keys());

    let end = path.indexOf('/', pos);
    if (end === -1) end = path.length;
    const seg = path.slice(pos, end);
    const nextPos = end === path.length ? end + 1 : end + 1;

    const methods = new Set<HttpMethod>();
    const staticChild = node.children.get(seg);
    if (staticChild) {
      for (const m of this._collectAllowed(staticChild, path, nextPos)) methods.add(m);
    }
    for (const { node: paramNode } of node.paramChildren) {
      for (const m of this._collectAllowed(paramNode, path, nextPos)) methods.add(m);
    }
    if (node.wildcardChild) {
      for (const m of this._collectAllowed(node.wildcardChild, path, path.length + 1)) methods.add(m);
    }
    return Array.from(methods);
  }
}
