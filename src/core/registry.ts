import { RouteDefinition } from "./types";

export interface RegisteredRoute {
  filePath: string;
  tag: string; // Used for grouping in Swagger/OpenAPI
  config: RouteDefinition<any, any, any, any>;
}

/**
 * An in-memory store for all discovered routes.
 */
class RouteRegistry {
  private routes: RegisteredRoute[] = [];

  /**
   * Adds a discovered route to the internal array.
   */
  public register(route: RegisteredRoute) {
    this.routes.push(route);
  }

  /**
   * Retrieves all registered routes.
   * Useful for the Server Adapters and OpenAPI generation.
   */
  public getAllRoutes(): RegisteredRoute[] {
    return this.routes;
  }

  /**
   * Clears the registry (crucial for hot-reloading in dev mode)
   */
  public clear() {
    this.routes = [];
  }
}

// Export a singleton instance so the entire package shares the same state
export const registry = new RouteRegistry();
