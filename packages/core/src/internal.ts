/**
 * Adapter-internal protocol — symbols and types that adapter packages must
 * import to call privileged Axiomify APIs.
 *
 * Why a symbol token? TypeScript has no friend-class mechanism. Methods like
 * `Axiomify.lockRoutes()` and `Axiomify.handleMatchedRoute()` are documented
 * `@internal` because they are part of the adapter protocol, NOT the user API.
 * Without a runtime guard, user code can call them anyway and break invariants
 * (silent route drift, double-routing). The symbol token makes accidental
 * misuse a hard runtime error while remaining trivial for first-party adapters
 * to opt into.
 *
 * The token is exported so that any adapter — including third-party ones —
 * can authenticate with the core. It is NOT a security boundary; it is an
 * intent gate.
 */
export const ADAPTER_LOCK_TOKEN: unique symbol = Symbol.for('axiomify.adapter.lock.v1');
export type AdapterLockToken = typeof ADAPTER_LOCK_TOKEN;

/**
 * Pluggable logger used across core for non-fatal warnings (hook errors,
 * cluster oversubscription, response-validation drift). Defaults to `console`.
 *
 * Adapters and applications can inject a structured logger (Pino, Winston) by
 * passing one to the `Axiomify` constructor. Doing so is strongly recommended
 * in production — the default `console.error` does not produce structured
 * output that observability stacks can index on.
 */
export interface AxiomifyLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const defaultLogger: AxiomifyLogger = {
  warn: (msg, meta) => console.warn(msg, meta ?? ''),
  error: (msg, meta) => console.error(msg, meta ?? ''),
};

// Legacy re-export — preserved so external code importing CompiledRouteDefinition
// from this module continues to compile. Will be removed in v6.
export type { CompiledState as CompiledRouteDefinition } from './compiled';
