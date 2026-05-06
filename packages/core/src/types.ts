import { Readable } from 'stream';
import { z, ZodTypeAny } from 'zod';

export interface FileConfig {
  maxSize: number; // in bytes
  accept: string[]; // e.g., ['image/jpeg', 'image/png']
  autoSaveTo: string; // The directory to pipe the stream to
  rename?: (originalName: string, mimetype: string) => string | Promise<string>;
  /**
   * Maximum number of files accepted for this field.
   * Defaults to 1 so repeated multipart fields cannot overwrite each other.
   */
  maxFiles?: number;
  /**
   * Preserve the sanitized original filename when no rename() function is
   * provided. Defaults to false; generated names avoid cross-user collisions.
   */
  preserveOriginalName?: boolean;
  /**
   * Validate file contents against known magic bytes when the accepted MIME
   * type is supported by the upload plugin. Defaults to true.
   */
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

export type SerializerFn =
  | ((input: SerializerInput) => any)
  | ((
      data: any,
      message?: string,
      statusCode?: number,
      isError?: boolean,
      req?: AxiomifyRequest,
    ) => any);

/**
 * RequestState is intentionally empty.
 * Packages can extend it without coupling via module augmentation.
 */
export interface RequestState {
  startTime?: bigint;
  [key: string]: any; // Allows users to append custom state safely
}

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
  readonly stream: import('stream').Readable;
  signal?: AbortSignal;
}

/**
 * Describes which optional capabilities a specific transport adapter
 * supports. Check before calling optional response methods.
 */
export interface ResponseCapabilities {
  /** True when `sseInit()` / `sseSend()` are available on this response. */
  readonly sse: boolean;
  /** True when `stream()` is available on this response. */
  readonly streaming: boolean;
}

export interface AxiomifyResponse {
  status(code: number): this;
  header(key: string, value: string): this;
  getHeader(key: string): string | undefined;
  removeHeader(key: string): this;
  send<T>(data: T, message?: string): void;
  sendRaw(payload: any, contentType?: string): void;
  error(err: unknown): void;

  stream(readable: Readable, contentType?: string): void;

  /**
   * Describes which optional methods are available on the current transport.
   * Check `res.capabilities.sse` before calling `sseInit()` / `sseSend()`.
   */
  readonly capabilities: ResponseCapabilities;

  /**
   * Initialise an SSE stream. Only available when `res.capabilities.sse` is
   * true. Throws on transports that do not support SSE (e.g. native/uWS).
   */
  sseInit?(sseHeartbeatMs?: number): void;
  /**
   * Push an event over an SSE stream that was opened with `sseInit()`.
   * Only available when `res.capabilities.sse` is true.
   */
  sseSend?(data: any, event?: string): void;

  readonly statusCode: number;
  readonly raw: unknown;
  readonly headersSent: boolean;
}

/**
 * Narrowed response type for routes that use Server-Sent Events.
 * Cast `res` to this type after checking `res.capabilities.sse === true`.
 *
 * @example
 * if (!res.capabilities.sse) throw new Error('SSE not supported on this adapter');
 * const sse = res as SseCapableResponse;
 * sse.sseInit();
 * sse.sseSend({ tick: 1 });
 */
export interface SseCapableResponse extends AxiomifyResponse {
  sseInit(sseHeartbeatMs?: number): void;
  sseSend(data: any, event?: string): void;
}

export interface RouteGroup {
  route<S extends RouteSchema>(definition: RouteDefinition<S>): this;
  group(
    prefix: string,
    options: RouteGroupOptions,
    callback: (group: RouteGroup) => void,
  ): this;
  group(prefix: string, callback: (group: RouteGroup) => void): this;
}

/**
 * Native Zod Schema definition for routes
 */
export interface RouteSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  response?: ZodTypeAny | Record<number, ZodTypeAny>;
  files?: Record<string, FileConfig>;
  /**
   * OpenAPI 3.0 Security Requirement Object.
   * Defines which security schemes are required to execute this specific route.
   * Ensure the scheme name matches a definition in your global `components.securitySchemes`.
   * @example [{ bearerAuth: [] }]
   */
  security?: Array<Record<string, string[]>>;

  /**
   * OpenAPI tags used to logically group this route within the Swagger UI documentation.
   * @example ['Merchant', 'Authentication']
   */
  tags?: string[];

  /**
   * A detailed explanation of the route's behavior, displayed in the Swagger UI.
   * Supports Markdown formatting for rich text rendering.
   */
  description?: string;
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

/** @deprecated Use RouteMiddleware instead. */
export type PluginHandler = RouteMiddleware;
/** @deprecated Use RouteMiddleware instead. */
export type RoutePlugin = RouteMiddleware;

export interface RouteGroupOptions {
  plugins?: RouteMiddleware[];
}

/**
 * RouteDefinition now automatically infers the generic types directly from the Zod schema.
 */
export interface RouteDefinition<
  S extends RouteSchema = RouteSchema,
  B = S['body'] extends ZodTypeAny ? z.infer<S['body']> : unknown,
  Q = S['query'] extends ZodTypeAny ? z.infer<S['query']> : unknown,
  P = S['params'] extends ZodTypeAny ? z.infer<S['params']> : unknown,
> {
  method: HttpMethod;
  path: string;
  schema?: S;
  plugins?: RouteMiddleware[];
  timeout?: number; // milliseconds; overrides the global default when set
  handler: RouteHandler<B, Q, P, S['files']>;
}
