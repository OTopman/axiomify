/**
 * Hook Discovery — inspects the registered lifecycle hooks on a loaded
 * Axiomify app instance.
 *
 * Reads `app.hooks.hooks` which is a public readonly record of hook
 * arrays keyed by {@link HookType}: onRequest, onPreHandler,
 * onPostHandler, onError, onClose.
 */
import type { DiscoveredHook } from './types';

const HOOK_TYPES = [
  'onRequest',
  'onPreHandler',
  'onPostHandler',
  'onError',
  'onClose',
] as const;

/**
 * Extracts hook registration counts from the app's HookManager.
 * Returns one {@link DiscoveredHook} per hook type that has at least
 * one handler, plus any types with zero handlers for completeness.
 */
export function discoverHooks(app: any): DiscoveredHook[] {
  const hooks = app.hooks?.hooks;
  if (!hooks || typeof hooks !== 'object') {
    // Graceful fallback if hooks are not accessible.
    return HOOK_TYPES.map((type) => ({ type, count: 0, handlers: [] }));
  }

  return HOOK_TYPES.map((type) => {
    const list = hooks[type];
    const handlers = Array.isArray(list)
      ? list.map((fn: any) => fn.name || '(anonymous)')
      : [];
    return {
      type,
      count: handlers.length,
      handlers,
    };
  });
}
