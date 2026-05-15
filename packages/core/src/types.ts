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
 * @deprecated The 5-arg positional form will be removed in v6.
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
   * Will be removed in v6.
   */
  error(err: unknown): void;
  stream(readable: Readable, contentType?: string): void;
  readonly capabilities: ResponseCapabilities;
  sseInit?(sseHeartbeatMs?: number): void;
  sseSend?(data: any, event?: string): void;
  readonly statusCode: number;
  readonly raw: unknown;
  readonly headersSent: boolean;

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
  message?: ZodTypeAny;
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

export interface RouteGroupOptions {
  plugins?: RouteMiddleware[];
}

export interface RouteGroup {
  route<S extends RouteSchema>(definition: RouteDefinition<S>): this;
  ws<S extends RouteSchema, M = any>(definition: WsRouteDefinition<S, M>): this;
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

export interface WsClient<State = Record<string, any>> {
  readonly state: State;
  send(message: string | Buffer | object, isBinary?: boolean): void;
  close(): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, message: string | Buffer | object, isBinary?: boolean): void;
}

export interface WsRouteDefinition<
  S extends RouteSchema = RouteSchema,
  M = S['message'] extends ZodTypeAny ? z.infer<S['message']> : unknown,
> {
  path: string;
  schema?: S;
  plugins?: RouteMiddleware[];
  open?: (client: WsClient<RequestState>, req: AxiomifyRequest) => void;
  message?: (client: WsClient<RequestState>, data: M) => void;
  close?: (client: WsClient<RequestState>, code: number, reason: string) => void;
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
}

/** @deprecated Use AppConfigurator instead. Will be removed in v6. */
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
