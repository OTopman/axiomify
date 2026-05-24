/**
 * Language-agnostic Intermediate Representation (IR) for API schemas.
 *
 * Every ingestion engine (OpenAPI, GraphQL, Axiomify-app) normalizes its
 * source into this IR. Language-specific generators consume the IR to emit
 * idiomatic code. The IR is designed to be:
 *
 *   - Complete: captures all information needed for code generation
 *   - Language-neutral: no TypeScript/Python/Go-specific constructs
 *   - Graph-friendly: types reference each other by ID for cycle handling
 *   - Diffable: deterministic structure enables schema comparison
 *   - Extensible: metadata bags allow plugins to annotate nodes
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
export type IRTransport = 'rest' | 'graphql' | 'websocket' | 'sse' | 'grpc';

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
  | IRLiteralType;

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
  variables?: Record<string, {
    default: string;
    enum?: string[];
    description?: string;
  }>;
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
