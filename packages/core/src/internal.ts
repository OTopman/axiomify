/**
 * Adapter-internal protocol — capability token and types that adapter packages
 * must import to call privileged Axiomify APIs.
 *
 * ## Why a frozen capability object instead of a symbol?
 *
 * The previous implementation used `Symbol.for('axiomify.native.lock.v1')` which
 * created two attack surfaces:
 *
 *  1. **Symbol forgery**: any code can create `Symbol('axiomify.native.lock')` —
 *     `Symbol.for()` is globally shared and can be reproduced by string.
 *  2. **Stack-trace authorization**: the old `lockRoutes()` supplemented the symbol
 *     check with V8 stack frame inspection (`callerFrame.includes('packages/native')`).
 *     After `tsup` bundles all packages to a single file, those path strings vanish —
 *     making every legitimate adapter call fail in production bundles.
 *
 * A **frozen capability object** created exactly once at module-init time is:
 *  - Unforgeable: you cannot create a second reference equal (`===`) to it without
 *    importing it from this module.
 *  - Bundle-safe: object identity survives bundling (same module instance, same reference).
 *  - Not a security boundary: adapters are trusted; this is an intent gate only.
 *
 * The token is exported so first- and third-party adapters can authenticate with
 * privileged core APIs (`lockRoutes`, `handleMatchedRoute`).
 */

const _adapterCapability = Object.freeze({
  _brand: 'axiomify.adapter.v2',
} as const);

/** Opaque capability token. Pass to privileged APIs to prove adapter identity. */
export type AdapterCapability = typeof _adapterCapability;

/** The single instance of the adapter capability token. Import and pass to lockRoutes(). */
export const ADAPTER_LOCK_TOKEN: AdapterCapability = _adapterCapability;

/** @deprecated Use AdapterCapability. Will be removed in v6. */
export type AdapterLockToken = AdapterCapability;

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
  trace?(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  fatal?(message: string, meta?: Record<string, unknown>): void;
}

export const defaultLogger: AxiomifyLogger = {
  trace: (msg, meta) => console.debug(msg, meta ?? ''),
  debug: (msg, meta) => console.debug(msg, meta ?? ''),
  info: (msg, meta) => console.log(msg, meta ?? ''),
  warn: (msg, meta) => console.warn(msg, meta ?? ''),
  error: (msg, meta) => console.error(msg, meta ?? ''),
  fatal: (msg, meta) => console.error(msg, meta ?? ''),
};

// Legacy re-export — preserved so external code importing CompiledRouteDefinition
// from this module continues to compile. Will be removed in v6.
export type { CompiledState as CompiledRouteDefinition } from './compiled';
