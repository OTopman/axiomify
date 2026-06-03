/**
 * Discovery result types for Axiomify Studio.
 *
 * These types define the shape of metadata extracted from a loaded Axiomify
 * app instance. Every discovery module produces one of these result types,
 * and the API layer serialises them to JSON for the Studio frontend.
 */

// ─── Route Discovery ────────────────────────────────────────────────────────

export interface DiscoveredRoute {
  method: string;
  path: string;
  /** Whether this is a WebSocket route (method will be 'WS'). */
  isWs: boolean;
  /** Zod validation field names present on this route. */
  validation: string[];
  /** OpenAPI tags from `schema.tags`. */
  tags: string[];
  /** OpenAPI operationId from `schema.operationId`. */
  operationId?: string;
  /** OpenAPI summary from `schema.summary`. */
  summary?: string;
  /** OpenAPI description from `schema.description`. */
  description?: string;
  /** Whether the route is marked deprecated. */
  deprecated: boolean;
  /** Route-level timeout in milliseconds, if set. */
  timeout?: number;
  /** Number of plugins (middleware) attached to this route. */
  pluginCount: number;
  /** Names of plugins (middleware) attached to this route. */
  plugins?: string[];
  /** Whether a response schema is defined. */
  hasResponseSchema: boolean;
}

// ─── Schema Discovery ────────────────────────────────────────────────────────

export interface DiscoveredSchema {
  /** Route identifier: `${method}:${path}` */
  routeId: string;
  method: string;
  path: string;
  /** JSON Schema representation of the body Zod schema, if present. */
  body?: Record<string, unknown>;
  /** JSON Schema representation of the query Zod schema, if present. */
  query?: Record<string, unknown>;
  /** JSON Schema representation of the params Zod schema, if present. */
  params?: Record<string, unknown>;
  /** JSON Schema representation of the response Zod schema, if present. */
  response?: Record<string, unknown> | Record<string, Record<string, unknown>>;
  /** JSON Schema representation of the message Zod schema (WS only), if present. */
  message?: Record<string, unknown>;
  /** File upload configuration, if present. */
  files?: Record<string, unknown>;
}

// ─── Hook Discovery ──────────────────────────────────────────────────────────

export interface DiscoveredHook {
  /** Hook type: onRequest, onPreHandler, onPostHandler, onError, onClose. */
  type: string;
  /** Number of handlers registered for this hook type. */
  count: number;
  /** Names of registered hook handler functions. */
  handlers?: string[];
}

// ─── Config Discovery ────────────────────────────────────────────────────────

export interface DiscoveredConfig {
  /** Default request timeout in milliseconds (0 = no timeout). */
  timeout: number;
  /** Route conflict handling strategy. */
  routeConflict: 'throw' | 'warn';
  /** Whether strictSchema mode is enabled. */
  strictSchema: boolean;
  /** Total number of registered HTTP routes. */
  httpRouteCount: number;
  /** Total number of registered WebSocket routes. */
  wsRouteCount: number;
  /** Total number of registered hooks (across all types). */
  hookCount: number;
  /** Total number of registered DI services. */
  serviceCount: number;
}

// ─── OpenAPI Discovery ───────────────────────────────────────────────────────

/** The full OAS 3.1 spec as a JSON-serialisable object. */
export type DiscoveredOpenApiSpec = Record<string, unknown>;

// ─── Health Discovery ────────────────────────────────────────────────────────

export interface DiscoveredHealthFinding {
  severity: 'ok' | 'warn' | 'fail';
  area: string;
  message: string;
  hint?: string;
}

export interface DiscoveredHealth {
  findings: DiscoveredHealthFinding[];
  summary: {
    passes: number;
    warnings: number;
    failures: number;
  };
}

// ─── Aggregate Discovery Result ──────────────────────────────────────────────

export interface DiscoveredService {
  token: string;
  type: string;
  methods: string[];
}

export interface OpenApiDriftResult {
  hasFile: boolean;
  synced: boolean;
  diffs: string[];
}

export interface DiscoveredEvent {
  emitterToken: string;
  event: string;
  listenerCount: number;
  listeners: string[];
}

export interface RouteDependencyNode {
  name: string;
  type: 'route' | 'middleware' | 'validation' | 'controller' | 'service' | 'database';
  children?: RouteDependencyNode[];
}

export interface ArchComponentNode {
  id: string;
  label: string;
  type: 'controller' | 'service' | 'repository' | 'database';
  dependencies: string[];
}

export interface StudioDiscoveryResult {
  routes: DiscoveredRoute[];
  schemas: DiscoveredSchema[];
  hooks: DiscoveredHook[];
  config: DiscoveredConfig;
  openapi: DiscoveredOpenApiSpec | null;
  health: DiscoveredHealth;
  /** Discovered services in the DI container. */
  services?: DiscoveredService[];
  /** OpenAPI specification file drift audit. */
  drift?: OpenApiDriftResult;
  /** Discovered masked environment variables. */
  env?: Record<string, string>;
  /** Discovered event bus events and listeners. */
  events?: DiscoveredEvent[];
  /** Application architecture mapping. */
  archMap?: ArchComponentNode[];
  /** ISO 8601 timestamp of when this discovery was performed. */
  discoveredAt: string;
}
