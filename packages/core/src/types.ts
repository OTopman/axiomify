import { z, ZodTypeAny } from 'zod';

export interface FileConfig {
  maxSize: number; // in bytes
  accept: string[]; // e.g., ['image/jpeg', 'image/png']
  autoSaveTo: string; // The directory to pipe the stream to
  rename?: (originalName: string, mimetype: string) => string | Promise<string>;
}

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD';

/**
 * RequestState is intentionally empty.
 * Packages can extend it without coupling via module augmentation.
 */
export interface RequestState {}

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

  readonly body: Body;
  readonly query: Query;
  readonly params: Params;

  readonly state: RequestState;
  readonly raw: unknown;
  readonly stream: import('stream').Readable;
}

export interface AxiomifyResponse {
  status(code: number): this;
  header(key: string, value: string): this;
  removeHeader(key: string): this;
  send<T>(data: T, message?: string): void;
  sendRaw(payload: any, contentType?: string): void;
  error(err: unknown): void;
  readonly raw: unknown;
  readonly headersSent: boolean;
}

/**
 * Native Zod Schema definition for routes
 */
export interface RouteSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  response?: ZodTypeAny;
  files?: Record<string, FileConfig>;
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

export type PluginHandler = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
) => void | Promise<void>;

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
  plugins?: string[];
  handler: RouteHandler<B, Q, P, S['files']>;
}
