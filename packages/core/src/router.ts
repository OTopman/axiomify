import type { HttpMethod, RouteDefinition } from './types';

interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
}

export type RouterLookupResult =
  | { route: RouteDefinition; params: Record<string, string> }
  | { error: 'MethodNotAllowed'; allowed: HttpMethod[] }
  | null;

class TrieNode {
  public children = new Map<string, TrieNode>();
  public paramChild: TrieNode | null = null;
  public paramName: string | null = null;
  public wildcardChild: TrieNode | null = null;
  public routes = new Map<HttpMethod, RouteDefinition>();
}

export class Router {
  private root = new TrieNode();

  /**
   * Registers a route into the Radix Tree.
   * Executed only during application startup to maximize runtime performance.
   */
  public register(route: RouteDefinition): void {
    const parts = this.splitPath(route.path);
    let currentNode = this.root;

    for (const part of parts) {
      if (part.startsWith(':')) {
        // Handle dynamic parameters (e.g., :id)
        if (!currentNode.paramChild) {
          currentNode.paramChild = new TrieNode();
          currentNode.paramName = part.slice(1);
        } else if (currentNode.paramName !== part.slice(1)) {
          throw new Error(
            `Route conflict: cannot register "${route.path}" — ` +
              `param name ":${part.slice(1)}" conflicts with existing ` +
              `":${currentNode.paramName}" at the same position. ` +
              `Use the same param name for sibling dynamic routes.`,
          );
        }
        currentNode = currentNode.paramChild;
      } else if (part === '*') {
        // Handle wildcard segments
        if (!currentNode.wildcardChild) {
          currentNode.wildcardChild = new TrieNode();
        }
        currentNode = currentNode.wildcardChild;

        // Wildcard must be the last segment
        const remainingParts = parts.slice(parts.indexOf(part) + 1);
        if (remainingParts.length > 0) {
          throw new Error(
            `Invalid route "${route.path}": wildcard * must be the final path segment.`,
          );
        }
        break; // nothing after * is valid
      } else {
        // Handle static path segments
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

    currentNode.routes.set(route.method, route);
  }

  /**
   * High-speed lookup for incoming requests.
   * Returns the matched route and any extracted dynamic parameters.
   */
  public lookup(method: HttpMethod, path: string): RouterLookupResult {
    let currentNode = this.root;
    const params: Record<string, string> = {};
    const parts = this.splitPath(path);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (currentNode.children.has(part)) {
        currentNode = currentNode.children.get(part)!;
      } else if (currentNode.paramChild) {
       const paramName = currentNode.paramName!;
       currentNode = currentNode.paramChild;
       params[paramName] = part;
      } else if (currentNode.wildcardChild) {
        params['*'] = parts.slice(i).join('/');
        currentNode = currentNode.wildcardChild;
        break;
      } else {
        return null; // 404
      }
    }

    let route = currentNode.routes.get(method);

    // Auto-handle HEAD requests using GET handlers
    if (!route && method === 'HEAD') {
      route = currentNode.routes.get('GET');
    }

    if (!route) {
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

    return { route, params };
  }

  /**
   * Normalizes and splits the path, ignoring trailing slashes.
   */
  private splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }
}
