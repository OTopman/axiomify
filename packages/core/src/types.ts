import { Readable } from 'stream';
import { z, ZodTypeAny } from 'zod';

export interface FileConfig {
  maxSize: number;
  accept: string[];
  autoSaveTo: string;
  rename?: (originalName: string, mimetype: string) => string | Promise<string>;
  maxFiles?: number;
  preserveOriginalName?: boolean;
  validateContent?: boolean;
}

export type HttpMethod =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export type HookType =
  'onRequest' | 'onPreHandler' | 'onPostHandler' | 'onError' | 'onClose';

export interface SerializerInput {
  data: any;
  message?: string;
  statusCode?: number;
  isError?: boolean;
  req?: AxiomifyRequest;
}

/**
 * Response serializer signature.
 *
 * Receives a single {@link SerializerInput} object and returns the value
 * that will be JSON-serialised as the response body.
 *
 * Must be synchronous — a Promise return would JSON.stringify to
 * `[object Promise]` on every response. The 5-argument positional form
 * supported in 4.x was removed in 5.0.0 (see CHANGELOG).
 */
export type SerializerFn = (input: SerializerInput) => unknown;

export interface RequestState {
  get(key: string): any;
  set(key: string, value: unknown): void;
  startTime?: bigint;
  [key: string]: any;
}

export interface AxiomifyConfig {
  timeout?: number;
  telemetry?: {
    startSpan: (
      name: string,
      attributes: Record<string, string>,
    ) => { end(): void };
  };
  logger?: any;
  routeConflict?: 'throw' | 'warn';
  strictSchema?: boolean;
}

export type AxiomifyOptions = AxiomifyConfig;

export interface AxiomifyRequest<
  Body = unknown,
  Query = unknown,
  Params = unknown,
> {
  readonly id: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly path: string;
  readonly ip: string;
  readonly headers: Record<string, string | string[] | undefined>;
  body: Body;
  query: Query;
  params: Params;
  readonly state: RequestState;
  readonly raw: unknown;
  readonly stream: Readable;
  signal?: AbortSignal;
  /**
   * Parsed request cookies. Adapters populate this lazily; plugins that must
   * work on any adapter should use `getCookies(req)` from core, which falls
   * back to parsing the `Cookie` header directly.
   */
  readonly cookies?: Record<string, string>;
}

export interface ResponseCapabilities {
  readonly sse: boolean;
  readonly streaming: boolean;
}

export interface AxiomifyResponse {
  status(code: number): this;
  header(key: string, value: string): this;
  getHeader(key: string): string | undefined;
  removeHeader(key: string): this;
  send<T>(data: T, message?: string): void;
  sendRaw(payload: any, contentType?: string): void;
  stream(readable: Readable, contentType?: string): void;
  readonly capabilities: ResponseCapabilities;
  sseInit?(sseHeartbeatMs?: number): void;
  sseSend?(data: any, event?: string): void;
  readonly statusCode: number;
  readonly raw: unknown;
  readonly headersSent: boolean;

  /**
   * Queue a `Set-Cookie` header. Unlike `header()`, multiple calls emit
   * multiple `Set-Cookie` lines (RFC 6265 forbids folding them into one).
   * Optional — implemented by first-party adapters; use `setCookie(res, …)`
   * from core for an adapter-agnostic call with a safe fallback.
   */
  cookie?(
    name: string,
    value: string,
    options?: import('./cookies').CookieOptions,
  ): this;
  /** Expire a cookie previously set with matching domain/path attributes. */
  clearCookie?(
    name: string,
    options?: Pick<
      import('./cookies').CookieOptions,
      'domain' | 'path' | 'secure' | 'sameSite'
    >,
  ): this;

  /** Set by the response implementation when streaming has begun. */
  isStreaming?: boolean;
  /** Assigned by the dispatcher to defer onClose hooks until stream end. */
  onStreamClose?: (() => void) | null;
}

export interface SseCapableResponse extends AxiomifyResponse {
  sseInit(sseHeartbeatMs?: number): void;
  sseSend(data: any, event?: string): void;
}

/**
 * Validation schemas and OpenAPI 3.1.0 Operation Object metadata for a route.
 *
 * **Axiomify uses a single `schema:` block** for both runtime validation
 * (Zod types) and documentation metadata (OAS Operation Object fields).
 * This keeps route definitions compact and matches the original 4.x pattern
 * users were familiar with.
 *
 * ### Validation fields (Zod types)
 * `body`, `query`, `params`, `response`, `files`, `message` — all optional.
 * The framework compiles these to AJV validators at startup.
 *
 * ### Documentation fields (OpenAPI 3.1.0 Operation Object)
 * Every Operation Object property is supported. The three properties that
 * the framework derives automatically from the validation fields are NOT
 * accepted here (they would conflict):
 *
 *   - `parameters`  — derived from `params` + `query`
 *   - `requestBody` — derived from `body` + `files`
 *   - `responses`   — derived from `response`
 *
 * @example
 * app.route({
 *   method: 'GET',
 *   path: '/users/:id',
 *   schema: {
 *     // Validation
 *     params:   z.object({ id: z.string().uuid() }),
 *     response: z.object({ id: z.string(), name: z.string() }),
 *     // OpenAPI docs
 *     tags:        ['Users'],
 *     summary:     'Get user by id',
 *     operationId: 'getUserById',
 *     security:    [{ bearerAuth: [] }],
 *   },
 *   handler: async (req, res) => { ... },
 * });
 */
export interface RouteSchema {
  // ── Validation (Zod) ────────────────────────────────────────────────────────
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  response?: ZodTypeAny | Record<number, ZodTypeAny>;
  files?: Record<string, FileConfig>;
  /** WebSocket message schema — only used on `app.ws()` routes. */
  message?: ZodTypeAny;

  // ── OpenAPI 3.1.0 Operation Object metadata ─────────────────────────────────
  /**
   * Include this route in generated OpenAPI documents. Defaults to `true`.
   * Set to `false` for internal, operational, or otherwise undocumented routes.
   */
  openapi?: boolean;
  /** OAS §4.8.10.1 — grouping label(s). Swagger UI groups operations by tag. */
  tags?: string[];
  /** OAS §4.8.10.2 — short one-line title. Defaults to `${method} ${path}`. */
  summary?: string;
  /** OAS §4.8.10.3 — long-form CommonMark description rendered below the summary. */
  description?: string;
  /** OAS §4.8.10.4 — link to additional external documentation. */
  externalDocs?: OpenApiExternalDocs;
  /**
   * OAS §4.8.10.5 — unique identifier for client codegen tools
   * (openapi-typescript, openapi-generator, etc). Auto-synthesised from
   * method + path when omitted (e.g. `getUsersById`).
   */
  operationId?: string;
  /** OAS §4.8.10.9 — marks the operation deprecated in the docs UI. */
  deprecated?: boolean;
  /**
   * OAS §4.8.10.10 — per-operation security requirement. Overrides any
   * global security declared on `useOpenAPI(...)`. An empty array `[]`
   * explicitly opts this route OUT of all global security requirements.
   */
  security?: Array<Record<string, string[]>>;
  /**
   * OAS §4.8.10.11 — per-operation server overrides. Use when this endpoint
   * lives at a different host than the rest of the API (CDN upload routes, etc).
   */
  servers?: OpenApiServer[];
  /**
   * OAS §4.8.10.8 — out-of-band async webhook callbacks. Passed through
   * verbatim to the generated spec.
   */
  callbacks?: Record<string, unknown>;

  // ── Generator overrides ─────────────────────────────────────────────────────
  /** Override the auto-generated description on the `requestBody` object. */
  requestBodyDescription?: string;
  /**
   * Map of status-code → human-readable description, overriding the generator's
   * defaults (`Successful response` / `Response 4xx`).
   * @example { '200': 'User profile', '404': 'No user with the supplied id' }
   */
  responseDescriptions?: Record<string, string>;
}

/**
 * OpenAPI 3.0.3 Server Object
 * (https://spec.openapis.org/oas/v3.0.3#server-object).
 */
export interface OpenApiServer {
  url: string;
  description?: string;
  variables?: Record<
    string,
    { default: string; enum?: string[]; description?: string }
  >;
}

/**
 * OpenAPI 3.0.3 External Documentation Object
 * (https://spec.openapis.org/oas/v3.0.3#external-documentation-object).
 */
export interface OpenApiExternalDocs {
  url: string;
  description?: string;
}

/**
 * OpenAPI 3.0.3 Operation Object metadata for an Axiomify route.
 *
 * Shape follows the spec at https://spec.openapis.org/oas/v3.0.3#operation-object
 * verbatim. Every Operation Object property is supported, with THREE
 * intentional omissions because the framework derives them from the
 * route's `schema:`:
 *
 *   - `parameters`  — derived from `schema.params`, `schema.query`
 *                     (and headers, when supported).
 *   - `requestBody` — derived from `schema.body` + `schema.files`.
 *   - `responses`   — derived from `schema.response`. Required by the
 *                     OAS spec; auto-emitted by the generator.
 *
 * Two Axiomify-specific helpers let callers override the descriptions
 * the generator synthesises for the schema-derived sections, without
 * dropping to raw spec:
 *
 *   - `requestBodyDescription` — overrides the requestBody description.
 *   - `responseDescriptions`   — per-status response description map.
 *
 * @example
 * app.route({
 *   method: 'POST',
 *   path: '/users',
 *   schema: {
 *     body:        CreateUserSchema,
 *     tags:        ['Users'],
 *     summary:     'Create user',
 *     description: 'Creates a new user with the supplied profile',
 *     operationId: 'createUser',
 *   },
 *   handler: createUser,
 * });
 */
export interface OpenApiOperation {
  /** OAS §4.7.10.1 — grouping label(s) in the docs UI (Swagger groups by tag). */
  tags?: string[];
  /** OAS §4.7.10.2 — short one-line title. Defaults to `${method} ${path}`. */
  summary?: string;
  /**
   * OAS §4.7.10.3 — long-form CommonMark description rendered below the
   * summary.
   */
  description?: string;
  /** OAS §4.7.10.4 — link to additional external documentation. */
  externalDocs?: OpenApiExternalDocs;
  /**
   * OAS §4.7.10.5 — unique identifier used by client code generators
   * (openapi-typescript, openapi-generator, etc) to name the generated
   * function. If omitted, the OpenAPI plugin synthesises one from method
   * + path so codegen still produces stable names.
   */
  operationId?: string;
  /**
   * OAS §4.7.10.9 — marks the operation deprecated in the docs UI.
   * Generated client code typically emits deprecation warnings on call.
   */
  deprecated?: boolean;
  /**
   * OAS §4.7.10.10 — per-operation security requirement. Overrides any
   * global security declared on `useOpenAPI(...)`. An empty array `[]`
   * explicitly opts this route OUT of all global security requirements
   * (OAS §4.7.10.10: "An empty array on this Operation Object overrides
   * any declaration at the top level").
   */
  security?: Array<Record<string, string[]>>;
  /**
   * OAS §4.7.10.11 — per-operation server overrides. Use when this single
   * endpoint lives at a different host than the rest of the API (CDN-hosted
   * upload routes, regional billing endpoints, etc).
   */
  servers?: OpenApiServer[];
  /**
   * OAS §4.7.10.8 — out-of-band async webhook callbacks. The shape is a
   * map of callback expressions to Path Item Objects. The full spec for
   * this nests deeply; passed through verbatim to the generated spec.
   * See https://spec.openapis.org/oas/v3.0.3#callback-object.
   */
  callbacks?: Record<string, unknown>;

  // ─── Axiomify-specific generator overrides ────────────────────────────
  // Not part of the Operation Object spec — these tell the generator to
  // override the descriptions it would otherwise synthesise for the
  // schema-derived requestBody and responses sections.

  /**
   * Override the auto-generated description on the requestBody object.
   * Useful when the same body schema is reused across multiple routes
   * and each needs different prose.
   */
  requestBodyDescription?: string;
  /**
   * Map of status-code → human-readable description, overriding the
   * generator's defaults (`Successful response` / `Response 4xx`).
   * Keys are strings to match OpenAPI's shape and allow patterns like
   * `'2XX'` / `'default'`.
   *
   * @example
   *   responseDescriptions: {
   *     '200': 'User profile',
   *     '404': 'No user with the supplied id',
   *   }
   */
  responseDescriptions?: Record<string, string>;
}

export interface UploadedFile {
  originalName: string;
  savedName: string;
  path: string;
  size: number;
  mimetype: string;
}

export type RouteHandler<
  B = unknown,
  Q = unknown,
  P = unknown,
  F extends Record<string, any> | undefined = undefined,
> = (
  req: AxiomifyRequest<B, Q, P> & {
    files: F extends undefined ? undefined : Record<keyof F, UploadedFile>;
  },
  res: AxiomifyResponse,
) => Promise<void> | void;

export type RouteMiddleware = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
) => void | Promise<void>;

export interface RouteGroupOptions {
  plugins?: RouteMiddleware[];
}

export interface RouteGroup {
  /**
   * Register route middleware for routes declared after this call within this
   * group (and within nested groups). The middleware is never added to routes
   * outside the group, which makes this the plugin-encapsulation primitive.
   */
  use(plugin: RouteMiddleware): this;
  route<S extends RouteSchema>(definition: RouteDefinition<S>): this;
  ws<S extends RouteSchema, M = any>(definition: WsRouteDefinition<S, M>): this;
  group(
    prefix: string,
    options: RouteGroupOptions,
    callback: (group: RouteGroup) => void,
  ): this;
  group(prefix: string, callback: (group: RouteGroup) => void): this;
  /**
   * Register a hook scoped to this group — the encapsulation primitive.
   * Unlike `app.addHook()`, the handler never fires for traffic outside
   * the group, so plugins registered inside a group cannot pollute the
   * rest of the application.
   *
   * Scoping semantics:
   *   - `onPreHandler` / `onPostHandler` receive the matched route and are
   *     scoped **exactly**: they fire only for routes registered through
   *     this group (including nested groups).
   *   - `onRequest` / `onError` / `onClose` run without a route match and
   *     are scoped by **path prefix**: they fire for any request whose path
   *     falls under the group prefix (`:param` segments match any value).
   */
  addHook<T extends HookType>(
    type: T,
    handler: import('./lifecycle').HookHandlerMap[T],
  ): this;
}

export interface RouteDefinition<
  S extends RouteSchema = RouteSchema,
  B = S['body'] extends ZodTypeAny ? z.infer<S['body']> : unknown,
  Q = S['query'] extends ZodTypeAny ? z.infer<S['query']> : unknown,
  P = S['params'] extends ZodTypeAny ? z.infer<S['params']> : unknown,
> {
  method: HttpMethod;
  path: string;
  /**
   * Combined validation + OpenAPI metadata block.
   *
   * Zod fields (`body`, `query`, `params`, `response`, `files`) power runtime
   * validation. Documentation fields (`tags`, `summary`, `description`,
   * `operationId`, `security`, etc) drive the generated OpenAPI 3.1.0 spec.
   * Both live in `schema` — no separate `openapi:` property needed.
   *
   * @example
   *   schema: {
   *     body:        z.object({ name: z.string() }),
   *     response:    z.object({ id: z.string() }),
   *     tags:        ['Users'],
   *     summary:     'Create user',
   *     operationId: 'createUser',
   *   }
   */
  schema?: S;
  plugins?: RouteMiddleware[];
  timeout?: number;
  handler: RouteHandler<B, Q, P, S['files']>;
}

export interface WsClient<State = Record<string, any>> {
  readonly state: State;
  send(message: string | Buffer | object, isBinary?: boolean): void;
  close(): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(
    topic: string,
    message: string | Buffer | object,
    isBinary?: boolean,
  ): void;
}

export interface WsRouteDefinition<
  S extends RouteSchema = RouteSchema,
  M = S['message'] extends ZodTypeAny ? z.infer<S['message']> : unknown,
> {
  path: string;
  schema?: S;
  plugins?: RouteMiddleware[];
  compression?: number;
  maxPayloadLength?: number;
  idleTimeout?: number;
  open?: (client: WsClient<RequestState>, req: AxiomifyRequest) => void;
  message?: (client: WsClient<RequestState>, data: M) => void;
  close?: (
    client: WsClient<RequestState>,
    code: number,
    reason: string,
  ) => void;
  drain?: (client: WsClient<RequestState>) => void;
}

/**
 * Global service registry.
 * Users and plugins should augment this interface via declaration merging
 * to guarantee compile-time type safety for Dependency Injection.
 * * @example
 * declare module '@axiomify/core' {
 * interface AppServices {
 * 'db': DatabaseConnection;
 * 'logger': Logger;
 * }
 * }
 */
export interface AppServices {}

export interface AppContext {
  /**
   * Register a service. Enforces type correctness if the token is declared in AppServices.
   */
  provide<K extends keyof AppServices>(token: K, value: AppServices[K]): void;
  // Fallback overload for untyped legacy plugins (optional, but realistic for JS consumers)
  provide(token: string | symbol, value: unknown): void;

  /**
   * Resolve a service. Guarantees the correct return type without manual generic casting.
   */
  resolve<K extends keyof AppServices>(token: K): AppServices[K];
  // Fallback overload. Warns the user they are leaving type-safe territory.
  resolve<T = unknown>(token: string | symbol): T;

  /**
   * Vault ABAC helper — wraps a callable in the given module's AsyncLocalStorage
   * context so that `process.env` reads inside `fn` are authorized against the
   * Vault policy for `moduleName`.
   *
   * Without this, ALS context is only available during `mod.register()` at boot,
   * not during request handling. Use this in route handlers and middleware that
   * need to access vault-managed secrets at runtime.
   *
   * @example
   * app.route({
   *   method: 'GET', path: '/charge',
   *   handler: (req, res) =>
   *     ctx.vault.scope('payments', async () => {
   *       const key = process.env.STRIPE_SECRET; // authorized for 'payments'
   *       res.send({ ok: true });
   *     }),
   * });
   */
  vault: {
    scope<T>(moduleName: string, fn: () => T): T;
  };
}

export type AppConfigurator = (
  app: import('./app').Axiomify,
  context: AppContext,
) => void | Promise<void>;

export interface AppModule {
  name: string;
  dependencies?: string[];
  register: AppConfigurator;
}
