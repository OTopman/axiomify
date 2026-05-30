/**
 * Language-agnostic Intermediate Representation (IR) for API schemas.
 *
 * Every ingestion engine (OpenAPI, GraphQL, Axiomify-app, AsyncAPI) normalizes
 * its source into this IR. Language-specific generators consume the IR to emit
 * idiomatic code. The IR is designed to be:
 *
 *   - Complete: captures all information needed for code generation
 *   - Language-neutral: no TypeScript/Python/Go-specific constructs
 *   - Graph-friendly: types reference each other by ID for cycle handling
 *   - Diffable: deterministic structure enables schema comparison
 *   - Extensible: metadata bags allow plugins to annotate nodes
 *   - Contract-aware: event, streaming, auth, pagination, federation metadata
 */

// ─── Primitives ────────────────────────────────────────────────────────────────

/** Scalar types shared across all target languages. */
export type IRScalar =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'any'
  | 'void'
  | 'binary'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'uri'
  | 'email'
  | 'bigint';

/** Transport protocol for an endpoint. */
export type IRTransport =
  | 'rest'
  | 'graphql'
  | 'websocket'
  | 'sse'
  | 'grpc'
  | 'socket.io'
  | 'event';

/** HTTP methods. */
export type IRHttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD';

/** GraphQL operation types. */
export type IRGraphQLOperation = 'query' | 'mutation' | 'subscription';

/** Content types for request/response bodies. */
export type IRContentType =
  | 'application/json'
  | 'multipart/form-data'
  | 'application/x-www-form-urlencoded'
  | 'application/octet-stream'
  | 'text/plain'
  | 'text/event-stream';

// ─── Type Nodes ────────────────────────────────────────────────────────────────

/**
 * Base for all IR type nodes. Every type has a unique `id` within the schema,
 * used for graph references and cycle detection.
 */
export interface IRBaseType {
  /** Unique identifier within the schema (e.g. "User", "CreateUserInput"). */
  id: string;
  /** Human-readable description (from spec comments / JSDoc). */
  description?: string;
  /** Whether this type is deprecated. */
  deprecated?: boolean;
  /** Deprecation reason when deprecated is true. */
  deprecationReason?: string;
  /** Arbitrary plugin metadata keyed by plugin name. */
  metadata?: Record<string, unknown>;
  /** Schema lineage — tracks origin for diffing and incremental compilation. */
  lineage?: IRTypeLineage;
}

/** Object type — maps to interfaces/structs/classes. */
export interface IRObjectType extends IRBaseType {
  kind: 'object';
  fields: IRField[];
  /** Additional properties allowed beyond declared fields. */
  additionalProperties?: IRTypeRef | boolean;
  /** Discriminator for polymorphic schemas (OpenAPI discriminator / __typename). */
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
}

/** Array type — wraps an inner element type. */
export interface IRArrayType extends IRBaseType {
  kind: 'array';
  items: IRTypeRef;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

/** Enum type — fixed set of allowed values. */
export interface IREnumType extends IRBaseType {
  kind: 'enum';
  values: IREnumValue[];
  /** Underlying type of enum values (default: 'string'). */
  valueType: 'string' | 'number';
}

/** Single enum value. */
export interface IREnumValue {
  name: string;
  value: string | number;
  description?: string;
  deprecated?: boolean;
}

/** Union type — one of several possible types (OpenAPI oneOf / GraphQL union). */
export interface IRUnionType extends IRBaseType {
  kind: 'union';
  members: IRTypeRef[];
  discriminator?: {
    propertyName: string;
    mapping: Record<string, string>;
  };
}

/** Intersection type — combination of multiple types (OpenAPI allOf). */
export interface IRIntersectionType extends IRBaseType {
  kind: 'intersection';
  members: IRTypeRef[];
}

/** Scalar type wrapper with optional format constraints. */
export interface IRScalarType extends IRBaseType {
  kind: 'scalar';
  scalar: IRScalar;
  format?: string;
  constraints?: IRConstraints;
}

/** Map/Dictionary type — string-keyed with typed values. */
export interface IRMapType extends IRBaseType {
  kind: 'map';
  valueType: IRTypeRef;
}

/** Tuple type — fixed-length array with per-position types. */
export interface IRTupleType extends IRBaseType {
  kind: 'tuple';
  elements: IRTypeRef[];
}

/** Literal type — a specific constant value. */
export interface IRLiteralType extends IRBaseType {
  kind: 'literal';
  value: string | number | boolean | null;
}

/** Generic/parameterized type — e.g. PaginatedResponse<T>. */
export interface IRGenericType extends IRBaseType {
  kind: 'generic';
  /** Base type that is parameterized. */
  baseType: IRTypeRef;
  /** Type parameters with optional constraints. */
  typeParameters: IRTypeParameter[];
}

/** A type parameter declaration. */
export interface IRTypeParameter {
  name: string;
  /** Constraint on the type parameter (e.g. extends SomeType). */
  constraint?: IRTypeRef;
  /** Default type if not specified. */
  defaultType?: IRTypeRef;
}

/** All possible IR type node kinds. */
export type IRType =
  | IRObjectType
  | IRArrayType
  | IREnumType
  | IRUnionType
  | IRIntersectionType
  | IRScalarType
  | IRMapType
  | IRTupleType
  | IRLiteralType
  | IRGenericType;

// ─── Type References ──────────────────────────────────────────────────────────

/** A reference to a type — named ref or inline anonymous definition. */
export interface IRTypeRef {
  /** Reference to a named type by its `id`. Mutually exclusive with `inline`. */
  ref?: string;
  /** Inline anonymous type definition. Mutually exclusive with `ref`. */
  inline?: IRType;
  /** Whether this reference is nullable. */
  nullable?: boolean;
  /** Whether this is an array of the referenced type. */
  isArray?: boolean;
  /** Default value for optional fields. */
  defaultValue?: unknown;
  /** Generic type arguments (e.g. PaginatedResponse<User>). */
  typeArguments?: IRTypeRef[];
}

// ─── Fields ───────────────────────────────────────────────────────────────────

/** A field/property on an object type. */
export interface IRField {
  name: string;
  type: IRTypeRef;
  required: boolean;
  description?: string;
  deprecated?: boolean;
  deprecationReason?: string;
  readOnly?: boolean;
  writeOnly?: boolean;
  example?: unknown;
  constraints?: IRConstraints;
}

/** Validation constraints on scalar types and fields. */
export interface IRConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/** A single API endpoint (REST route, GraphQL operation, WS event). */
export interface IREndpoint {
  operationId: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated?: boolean;
  transport: IRTransport;

  // REST-specific
  method?: IRHttpMethod;
  path?: string;

  // GraphQL-specific
  graphqlOperation?: IRGraphQLOperation;
  graphqlField?: string;

  // Parameters
  pathParams: IRParameter[];
  queryParams: IRParameter[];
  headerParams: IRParameter[];

  // Request
  requestBody?: IRRequestBody;

  // Response
  responses: Record<string, IRResponse>;
  successResponse?: string;

  // Security
  security: IRSecurityRequirement[];

  // Pagination
  pagination?: IRPaginationMetadata;

  // Streaming
  streaming?: IRStreamingContract;

  metadata?: Record<string, unknown>;
}

/** A parameter (path, query, header). */
export interface IRParameter {
  name: string;
  location: 'path' | 'query' | 'header';
  type: IRTypeRef;
  required: boolean;
  description?: string;
  deprecated?: boolean;
  example?: unknown;
  style?: string;
  explode?: boolean;
}

/** Request body definition. */
export interface IRRequestBody {
  description?: string;
  required: boolean;
  contentType: IRContentType;
  type: IRTypeRef;
}

/** Response definition for a specific status code. */
export interface IRResponse {
  statusCode: string;
  description: string;
  contentType?: IRContentType;
  type?: IRTypeRef;
  headers?: IRParameter[];
}

/** Security requirement — which scheme + scopes are needed. */
export interface IRSecurityRequirement {
  schemeName: string;
  scopes: string[];
}

// ─── Security Schemes ─────────────────────────────────────────────────────────

export interface IRSecurityScheme {
  name: string;
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  in?: 'header' | 'query' | 'cookie';
  parameterName?: string;
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
}

// ─── Server / Environment ──────────────────────────────────────────────────

export interface IRServer {
  url: string;
  description?: string;
  variables?: Record<
    string,
    {
      default: string;
      enum?: string[];
      description?: string;
    }
  >;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

/** Pagination pattern metadata attached to endpoints that support pagination. */
export interface IRPaginationMetadata {
  /** Pagination strategy. */
  style: 'cursor' | 'offset' | 'page' | 'keyset';
  /** Name of the query parameter for page size / limit. */
  pageSizeParam?: string;
  /** Name of the cursor / offset / page query parameter. */
  cursorParam?: string;
  /** JSON path to the next cursor in the response body. */
  nextCursorPath?: string;
  /** JSON path to the items array in the response body. */
  itemsPath?: string;
  /** JSON path to the total count in the response body. */
  totalCountPath?: string;
  /** JSON path to the hasMore boolean in the response body. */
  hasMorePath?: string;
  /** Default page size. */
  defaultPageSize?: number;
  /** Maximum page size. */
  maxPageSize?: number;
}

// ─── Event Contracts ──────────────────────────────────────────────────────────

/** An event contract — for event-driven APIs (AsyncAPI, WebSocket, Socket.IO). */
export interface IREventContract {
  /** Unique event / channel name (e.g. "user.created"). */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Transport binding. */
  transport: 'websocket' | 'socket.io' | 'sse' | 'event';
  /** Channel / topic / room name pattern. */
  channel?: string;
  /** Direction from the SDK's perspective. */
  direction: 'inbound' | 'outbound' | 'bidirectional';
  /** Payload type for the event. */
  payload?: IRTypeRef;
  /** Acknowledgement/reply payload (for request/reply patterns). */
  ackPayload?: IRTypeRef;
  /** Whether the event requires acknowledgement. */
  requiresAck?: boolean;
  /** Headers or metadata attached to the event. */
  headers?: IRParameter[];
  /** Tags for grouping. */
  tags: string[];
  /** Security requirements for subscribing/publishing. */
  security: IRSecurityRequirement[];
  metadata?: Record<string, unknown>;
}

// ─── Streaming Contracts ──────────────────────────────────────────────────────

/** Streaming contract metadata — for SSE, chunked transfer, WebSocket streams. */
export interface IRStreamingContract {
  /** Stream transport mechanism. */
  transport: 'sse' | 'websocket' | 'chunked';
  /** Type of each streamed item. */
  itemType?: IRTypeRef;
  /** Heartbeat interval in milliseconds. */
  heartbeatMs?: number;
  /** Reconnection strategy. */
  reconnect?: {
    /** Whether auto-reconnect is enabled. */
    enabled: boolean;
    /** Max retry attempts. */
    maxRetries?: number;
    /** Base delay between retries in milliseconds. */
    baseDelayMs?: number;
  };
  /** Backpressure handling mode. */
  backpressure?: 'buffer' | 'drop' | 'latest';
  /** Event type names for SSE (maps event name → payload type). */
  eventTypes?: Record<string, IRTypeRef>;
}

// ─── Auth Contracts ───────────────────────────────────────────────────────────

/** Auth contract — describes how authentication flows work for the SDK. */
export interface IRAuthContract {
  /** Primary auth scheme name. */
  primaryScheme: string;
  /** Token injection point. */
  tokenInjection: {
    location: 'header' | 'query' | 'cookie';
    parameterName: string;
    prefix?: string;
  };
  /** Refresh token configuration. */
  refresh?: {
    endpoint: string;
    method: IRHttpMethod;
    tokenPath: string;
    expiresInPath?: string;
  };
  /** Available scopes for the API. */
  scopes?: Record<string, string>;
}

// ─── Reactive Contracts ───────────────────────────────────────────────────────

/** Reactive contract — for live queries, GraphQL subscriptions, presence. */
export interface IRReactiveContract {
  /** Channel or subscription name. */
  channel: string;
  /** Type of reactive update. */
  type: 'subscription' | 'live-query' | 'presence';
  /** Payload type for updates. */
  updateType?: IRTypeRef;
  /** Filter parameters for the subscription. */
  filters?: IRParameter[];
  /** Whether the subscription supports replay/catch-up. */
  supportsReplay?: boolean;
}

// ─── Federation Metadata ──────────────────────────────────────────────────────

/** Federation metadata — for federated/distributed schemas. */
export interface IRFederationMetadata {
  /** Service that owns this type or endpoint. */
  serviceName: string;
  /** Service boundary (types that cross service boundaries). */
  isShared?: boolean;
  /** Key fields for entity resolution across services. */
  keyFields?: string[];
  /** Whether this type is an entity root. */
  isEntity?: boolean;
  /** External fields resolved from other services. */
  externalFields?: string[];
}

// ─── Tenant Metadata ──────────────────────────────────────────────────────────

/** Multi-tenant metadata for tenant-aware SDK generation. */
export interface IRTenantMetadata {
  /** How tenant context is propagated. */
  propagation: 'header' | 'path' | 'query' | 'subdomain';
  /** Header / path parameter / query key name. */
  parameterName: string;
  /** Whether the tenant ID is required on every request. */
  required: boolean;
  /** Tenant-specific scopes or permissions. */
  scopes?: string[];
}

// ─── Schema Lineage ───────────────────────────────────────────────────────────

/** Tracks a type's origin across schema versions for diffing and lineage. */
export interface IRTypeLineage {
  /** SHA-256 hash of the type's canonical form. */
  fingerprint: string;
  /** Source file or spec section that produced this type. */
  sourceLocation?: string;
  /** Timestamp of last compilation (ISO-8601). */
  lastCompiled?: string;
  /** Parent schema ID if this type was derived. */
  parentSchemaId?: string;
}

// ─── Top-level Schema ──────────────────────────────────────────────────────

/**
 * The complete IR schema — the single source of truth for the entire
 * compilation pipeline. Output of every ingestion engine, input to
 * every language generator.
 */
export interface IRSchema {
  info: IRSchemaInfo;
  types: Map<string, IRType>;
  endpoints: IREndpoint[];
  securitySchemes: Map<string, IRSecurityScheme>;
  servers: IRServer[];
  globalSecurity: IRSecurityRequirement[];
  /** Event contracts for event-driven APIs. */
  events: IREventContract[];
  /** Auth contract describing token/refresh flows. */
  authContract?: IRAuthContract;
  /** Reactive contracts for subscriptions/live queries. */
  reactiveContracts: IRReactiveContract[];
  /** Pagination defaults for the API. */
  defaultPagination?: IRPaginationMetadata;
  /** Federation metadata for distributed schemas. */
  federation?: IRFederationMetadata;
  /** Multi-tenant configuration. */
  tenant?: IRTenantMetadata;
  /** Schema-level fingerprint for caching. */
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}

export interface IRSchemaInfo {
  title: string;
  version: string;
  description?: string;
  sourceFormat: 'openapi' | 'graphql' | 'axiomify' | 'event' | 'streaming';
  sourceVersion?: string;
}

// ─── Compilation Context ──────────────────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface IRDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  location?: string;
}

export interface IRCompilationResult {
  schema: IRSchema;
  diagnostics: IRDiagnostic[];
  hasErrors: boolean;
  durationMs: number;
}
