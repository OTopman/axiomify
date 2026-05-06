/**
 * @deprecated This module previously exported CompiledRouteDefinition, which
 * extended RouteDefinition and was stamped onto user-supplied route definition
 * objects at registration time — mutating caller-provided data.
 *
 * It has been replaced by the WeakMap-based approach in compiled.ts.
 * Import from compiled.ts instead.
 *
 * This file is kept temporarily to avoid breaking any external code that
 * imports from it. It will be removed in v5.
 */
export type { CompiledState as CompiledRouteDefinition } from './compiled';
