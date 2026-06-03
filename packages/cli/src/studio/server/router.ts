/**
 * Lightweight request router for Studio's internal API.
 *
 * This is NOT a general-purpose router — it handles only the small set
 * of `/__studio/*` paths that Studio needs. No radix trie, no params,
 * no middleware chain. Just a flat map of `METHOD PATH` → handler.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type StudioRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

export class StudioRouter {
  private routes = new Map<string, StudioRouteHandler>();

  /**
   * Register a handler for a specific method + path combination.
   * @example router.on('GET', '/__studio/api/routes', handler)
   */
  public on(method: string, path: string, handler: StudioRouteHandler): this {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
    return this;
  }

  /** Shorthand for GET routes. */
  public get(path: string, handler: StudioRouteHandler): this {
    return this.on('GET', path, handler);
  }

  /** Shorthand for POST routes. */
  public post(path: string, handler: StudioRouteHandler): this {
    return this.on('POST', path, handler);
  }

  /**
   * Look up a handler for the given request. Returns `null` if no
   * matching route is found.
   */
  public match(method: string, pathname: string): StudioRouteHandler | null {
    return this.routes.get(`${method.toUpperCase()} ${pathname}`) ?? null;
  }
}
