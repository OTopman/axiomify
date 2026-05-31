export { z } from 'zod';
export * from './app';
export * from './state';
export * from './compiled';
export * from './dispatcher';
export * from './errors';
export * from './lifecycle';
export * from './registry';
export * from './router';
export * from './sanitize';
export * from './serialize';
export * from './shutdown';
export * from './types';
export * from './validation';

// Adapter-internal protocol — exported so first- and third-party adapters can
// authenticate with privileged core APIs (lockRoutes, handleMatchedRoute) and
// share the logger interface.
export { ADAPTER_LOCK_TOKEN, defaultLogger } from './internal';
export type { AdapterLockToken, AxiomifyLogger, CompiledRouteDefinition } from './internal';

// Re-export capability types at the top level for convenience.
export type { ResponseCapabilities, SseCapableResponse } from './types';
