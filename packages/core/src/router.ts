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
  public paramChild: TrieNode | null = null;
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
        if (!currentNode.paramChild) {
          currentNode.paramChild = new TrieNode();
        }
        currentNode = currentNode.paramChild;
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
    let currentNode = this.root;
    const paramValues: string[] = []; // Store values positionally
    let wildcardValue: string | null = null;
    const parts = this.splitPath(path);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (currentNode.children.has(part)) {
        currentNode = currentNode.children.get(part)!;
      } else if (currentNode.paramChild) {
        currentNode = currentNode.paramChild;
        paramValues.push(part); // Push the raw value
      } else if (currentNode.wildcardChild) {
        wildcardValue = parts.slice(i).join('/');
        currentNode = currentNode.wildcardChild;
        break;
      } else {
        return null; // 404
      }
    }

    let payload = currentNode.routes.get(method);

    // Auto-handle HEAD requests
    if (!payload && method === 'HEAD') {
      payload = currentNode.routes.get('GET');
    }

    if (!payload) {
      // 405 Method Not Allowed Support
      if (currentNode.routes.size > 0) {
        const allowed = Array.from(currentNode.routes.keys());
        if (allowed.includes('GET') && !allowed.includes('HEAD')) {
          allowed.push('HEAD');
        }
        return { error: 'MethodNotAllowed', allowed };
      }
      return null;
    }

    // Map the positional values to the route's specific keys
    const params: Record<string, string> = {};
    for (let i = 0; i < payload.paramKeys.length; i++) {
      params[payload.paramKeys[i]] = paramValues[i];
    }
    if (wildcardValue !== null) {
      params['*'] = wildcardValue;
    }

    return { route: payload.definition, params };
  }

  /**
   * Normalizes and splits the path, ignoring trailing slashes.
   */
  private splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }
}
