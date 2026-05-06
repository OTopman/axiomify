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
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD';

export type HookType =
  | 'onRequest'
  | 'onPreHandler'
  | 'onPostHandler'
  | 'onError'
  | 'onClose';

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
 * Prefer the single-argument (object) form — it is forward-compatible
 * and avoids runtime fn.length introspection required by the 5-arg form.
 *
 * @deprecated The 5-arg positional form will be removed in v5.
 * Migrate: (data, msg, code, err, req) => ...
 *      to: ({ data, message, statusCode, isError, req }) => ...
 */
export type SerializerFn =
  | ((input: SerializerInput) => any)
  | ((data: any, message?: string, statusCode?: number, isError?: boolean, req?: AxiomifyRequest) => any);

export interface RequestState {
  startTime?: bigint;
  [key: string]: any;
}

export interface AxiomifyRequest<Body = unknown, Query = unknown, Params = unknown> {
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
  /**
   * @deprecated Use res.status(statusCode).send(null, message) instead.
   * Will be removed in v5.
   */
  error(err: unknown): void;
  stream(readable: Readable, contentType?: string): void;
  readonly capabilities: ResponseCapabilities;
  sseInit?(sseHeartbeatMs?: number): void;
  sseSend?(data: any, event?: string): void;
  readonly statusCode: number;
  readonly raw: unknown;
  readonly headersSent: boolean;
}

export interface SseCapableResponse extends AxiomifyResponse {
  sseInit(sseHeartbeatMs?: number): void;
  sseSend(data: any, event?: string): void;
}

/**
 * Validation schemas for a route's request and response shapes.
 * Only validation-relevant fields belong here.
 *
 * Documentation metadata (tags, description, security) belongs in
 * RouteMeta on the parent RouteDefinition.
 */
export interface RouteSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  response?: ZodTypeAny | Record<number, ZodTypeAny>;
  files?: Record<string, FileConfig>;
}

/**
 * OpenAPI / documentation metadata for a route.
 * Kept separate from RouteSchema so the validation layer has no knowledge
 * of documentation concerns, and the OpenAPI plugin does not need to reach
 * into RouteSchema to find non-validation fields.
 *
 * @example
 * app.route({
 *   method: 'POST',
 *   path: '/users',
 *   schema: { body: CreateUserSchema },
 *   meta: { tags: ['Users'], description: 'Create a new user' },
 *   handler: createUser,
 * });
 */
export interface RouteMeta {
  tags?: string[];
  description?: string;
  security?: Array<Record<string, string[]>>;
  summary?: string;
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

export type RouteMiddleware = (req: AxiomifyRequest, res: AxiomifyResponse) => void | Promise<void>;

/** @deprecated Use RouteMiddleware instead. Will be removed in v5. */
export type PluginHandler = RouteMiddleware;
/** @deprecated Use RouteMiddleware instead. Will be removed in v5. */
export type RoutePlugin = RouteMiddleware;

export interface RouteGroupOptions {
  plugins?: RouteMiddleware[];
}

export interface RouteGroup {
  route<S extends RouteSchema>(definition: RouteDefinition<S>): this;
  group(prefix: string, options: RouteGroupOptions, callback: (group: RouteGroup) => void): this;
  group(prefix: string, callback: (group: RouteGroup) => void): this;
}

export interface RouteDefinition<
  S extends RouteSchema = RouteSchema,
  B = S['body'] extends ZodTypeAny ? z.infer<S['body']> : unknown,
  Q = S['query'] extends ZodTypeAny ? z.infer<S['query']> : unknown,
  P = S['params'] extends ZodTypeAny ? z.infer<S['params']> : unknown,
> {
  method: HttpMethod;
  path: string;
  schema?: S;
  /**
   * OpenAPI / documentation metadata.
   * Replaces the previous pattern of embedding tags/description/security
   * inside schema (a validation type) where they did not belong.
   */
  meta?: RouteMeta;
  plugins?: RouteMiddleware[];
  timeout?: number;
  handler: RouteHandler<B, Q, P, S['files']>;
}

// ---------------------------------------------------------------------------
// App plugin / module types
// ---------------------------------------------------------------------------

export interface AppContext {
  provide<T>(key: string, value: T): void;
  resolve<T>(key: string): T;
}

/** @deprecated Use AppConfigurator instead. Will be removed in v5. */
export type AppPlugin = (app: import('./app').Axiomify) => void;

export type AppConfigurator = (
  app: import('./app').Axiomify,
  context: AppContext,
) => void | Promise<void>;

export interface AppModule {
  name: string;
  dependencies?: string[];
  register: AppConfigurator;
}
