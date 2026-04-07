import type { HttpMethod, RouteDefinition } from './types';

interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
}

class TrieNode {
  public children = new Map<string, TrieNode>();
  public paramChild: TrieNode | null = null;
  public paramName: string | null = null;
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
        }
        currentNode = currentNode.paramChild;
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
  public lookup(method: HttpMethod, path: string): RouteMatch | null {
    let currentNode = this.root;
    const params: Record<string, string> = {};

    let start = 1; // Skip the leading slash
    let end = path.indexOf('/', start);

    while (start < path.length) {
      const isLast = end === -1;
      const part = path.substring(start, isLast ? path.length : end);

      if (part.length > 0) {
        if (currentNode.children.has(part)) {
          currentNode = currentNode.children.get(part)!;
        } else if (currentNode.paramChild) {
          const paramName = currentNode.paramName!;
          currentNode = currentNode.paramChild;
          params[paramName] = part;
        } else {
          return null; // 404
        }
      }

      if (isLast) break;
      start = end + 1;
      end = path.indexOf('/', start);
    }

    const route = currentNode.routes.get(method);
    if (!route) return null;

    return { route, params };
  }

  /**
   * Normalizes and splits the path, ignoring trailing slashes.
   */
  private splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }
}
