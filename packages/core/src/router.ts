import type { HttpMethod, RouteDefinition } from './types';

interface RoutePayload {
  definition: RouteDefinition;
  paramKeys: string[];
}

export type RouterLookupResult =
  | { route: RouteDefinition; params: Record<string, string> }
  | { error: 'MethodNotAllowed'; allowed: HttpMethod[] }
  | null;

class TrieNode {
  public children = new Map<string, TrieNode>();
  public paramChildren = new Map<string, TrieNode>();
  public wildcardChild: TrieNode | null = null;
  public routes = new Map<HttpMethod, RoutePayload>();
}

export class Router {
  private root = new TrieNode();

  /**
   * Registers a route into the Radix Tree.
   * Executed only during application startup to maximize runtime performance.
   */
  public register(route: RouteDefinition): void {
    const parts = this.splitPath(route.path);
    const paramKeys: string[] = []; // Store keys for this specific route
    let currentNode = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part.startsWith(':')) {
        paramKeys.push(part.slice(1)); // Save the parameter name
        if (!currentNode.paramChildren.has(part)) {
          currentNode.paramChildren.set(part, new TrieNode());
        }
        currentNode = currentNode.paramChildren.get(part)!;
      } else if (part === '*') {
        if (i !== parts.length - 1) {
          throw new Error(
            `Invalid route "${route.path}": wildcard * must be the final path segment.`,
          );
        }
        if (!currentNode.wildcardChild) {
          currentNode.wildcardChild = new TrieNode();
        }
        currentNode = currentNode.wildcardChild;
      } else {
        if (!currentNode.children.has(part)) {
          currentNode.children.set(part, new TrieNode());
        }
        currentNode = currentNode.children.get(part)!;
      }
    }

    if (currentNode.routes.has(route.method)) {
      throw new Error(
        `Route collision: ${route.method} ${route.path} is already registered.`,
      );
    }

    // Store the extracted paramKeys alongside the definition
    currentNode.routes.set(route.method, { definition: route, paramKeys });
  }

  /**
   * High-speed lookup for incoming requests.
   * Returns the matched route and any extracted dynamic parameters.
   */
  public lookup(method: HttpMethod, path: string): RouterLookupResult {
    const parts = this.splitPath(path);
    const match = this.lookupNode(this.root, parts, 0, method, []);
    if (match) return match;
    const allowed = this.collectAllowedMethods(this.root, parts, 0);
    if (allowed.length > 0) {
      if (allowed.includes('GET') && !allowed.includes('HEAD')) allowed.push('HEAD');
      return { error: 'MethodNotAllowed', allowed };
    }
    return null;
  }

  private lookupNode(
    node: TrieNode,
    parts: string[],
    index: number,
    method: HttpMethod,
    params: Array<[string, string]>,
  ): { route: RouteDefinition; params: Record<string, string> } | null {
    if (index === parts.length) {
      let payload = node.routes.get(method);
      if (!payload && method === 'HEAD') payload = node.routes.get('GET');
      if (!payload) return null;
      const out: Record<string, string> = {};
      for (let i = 0; i < params.length; i++) {
        out[params[i][0]] = params[i][1];
      }
      return { route: payload.definition, params: out };
    }

    const part = parts[index];
    const staticNode = node.children.get(part);
    if (staticNode) {
      const match = this.lookupNode(staticNode, parts, index + 1, method, params);
      if (match) return match;
    }

    for (const [token, paramNode] of node.paramChildren) {
      const key = token.slice(1);
      const match = this.lookupNode(
        paramNode,
        parts,
        index + 1,
        method,
        [...params, [key, part]],
      );
      if (match) return match;
    }

    if (node.wildcardChild) {
      const wildcardParams = [...params, ['*', parts.slice(index).join('/')]];
      const wildcardMatch = this.lookupNode(
        node.wildcardChild,
        parts,
        parts.length,
        method,
        wildcardParams,
      );
      if (wildcardMatch) return wildcardMatch;
    }

    return null;
  }

  private collectAllowedMethods(
    node: TrieNode,
    parts: string[],
    index: number,
  ): HttpMethod[] {
    if (index === parts.length) {
      return Array.from(node.routes.keys());
    }
    const part = parts[index];
    const methods = new Set<HttpMethod>();
    const staticNode = node.children.get(part);
    if (staticNode) {
      for (const m of this.collectAllowedMethods(staticNode, parts, index + 1)) methods.add(m);
    }
    for (const paramNode of node.paramChildren.values()) {
      for (const m of this.collectAllowedMethods(paramNode, parts, index + 1)) methods.add(m);
    }
    if (node.wildcardChild) {
      for (const m of this.collectAllowedMethods(node.wildcardChild, parts, parts.length)) methods.add(m);
    }
    return Array.from(methods);
  }

  /**
   * Normalizes and splits the path, ignoring trailing slashes.
   */
  private splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }
}
