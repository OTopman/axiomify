import type { ZodTypeAny } from 'zod';
import { defaultLogger, type AxiomifyLogger } from './internal';
import type { AxiomifyRequest, RouteSchema } from './types';

// ─── AJV 2020-12 (bundled with ajv@^8) ───────────────────────────────────────
// ajv/dist/2020 supports the JSON Schema 2020-12 dialect, which is exactly what
// Zod v4's `z.toJSONSchema()` emits. The import is wrapped in try/catch so the
// module degrades gracefully when ajv is not installed.

type AjvClass = {
  new (opts: Record<string, unknown>): {
    compile: (schema: object) => ((data: unknown) => boolean) & {
      errors?: Array<{
        instancePath: string;
        keyword: string;
        message?: string;
      }> | null;
    };
  };
};

let Ajv2020: AjvClass | null = null;
try {
  // ajv is a direct dependency of many Node.js projects; it ships 2020-12 in
  // its dist directory since v8.6.0.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('ajv/dist/2020');
  Ajv2020 = mod.default ?? mod;
} catch {
  /* fall back to Zod only */
}

// Lazily constructed — one instance per process, shared across all routes.
let _ajv: ReturnType<AjvClass['prototype']['compile']> extends never
  ? never
  : InstanceType<AjvClass> | null = null;
function getAjv() {
  if (!Ajv2020) return null;
  if (!_ajv) {
    _ajv = new Ajv2020({
      strict: false, // permits keywords from zod-to-json-schema / z.toJSONSchema
      allErrors: true, // collect all field errors in a single pass
      coerceTypes: false, // never coerce — Zod handles type coercion in transforms
    });
  }
  return _ajv;
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  public readonly errors: Record<string, Record<string, string>>;
  public readonly statusCode: number;

  constructor(
    message: string,
    errors: Record<string, Record<string, string>>,
    statusCode = 400,
  ) {
    let finalMessage = message;
    if (
      (message === 'Request validation failed' ||
        message === 'Response validation failed') &&
      errors
    ) {
      const parts: string[] = [];
      for (const [location, fieldErrors] of Object.entries(errors)) {
        if (fieldErrors && typeof fieldErrors === 'object') {
          for (const [field, msg] of Object.entries(fieldErrors)) {
            parts.push(`${location}.${field} (${msg})`);
          }
        }
      }
      if (parts.length > 0) {
        finalMessage = `Validation failed: ${parts.join(', ')}`;
      }
    }
    super(finalMessage);
    this.name = 'ValidationError';
    this.errors = errors;
    this.statusCode = statusCode;
  }
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

function isZodSchema(value: unknown): value is ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

// ─── Type coercion ────────────────────────────────────────────────────────────
// HTTP query strings and URL params always arrive as strings. When a schema
// declares `z.number()` the raw value `"5"` should be coerced to `5`, not
// rejected. This pre-coercion step walks the JSON Schema and converts string
// values to the expected type *before* AJV or Zod sees them. Non-castable
// values (e.g. `"abc"` for a number field) are left as-is so the downstream
// validator can produce a proper error.

/**
 * Recursively coerces string values in `data` to the types declared in
 * `jsonSchema`. Mutates `data` in place for performance (objects are
 * already ephemeral per-request).
 *
 * Supported coercions:
 *   - string → number / integer  (via `Number()`, rejects NaN)
 *   - string → boolean           (`"true"` → true, `"false"` → false)
 *   - arrays of the above
 */
function preCoerce(
  data: unknown,
  jsonSchema: Record<string, unknown>,
): unknown {
  if (data === null || data === undefined) return data;

  const schemaType = jsonSchema.type as string | string[] | undefined;

  // ── Scalar coercion ──────────────────────────────────────────────────────
  if (typeof data === 'string') {
    const targetType = Array.isArray(schemaType) ? schemaType[0] : schemaType;
    if (targetType === 'number' || targetType === 'integer') {
      const n = Number(data);
      if (!Number.isNaN(n) && data.trim() !== '') return n;
      return data; // leave as-is — validator will reject
    }
    if (targetType === 'boolean') {
      if (data === 'true') return true;
      if (data === 'false') return false;
      return data; // leave as-is
    }
    return data;
  }

  // ── Array coercion ───────────────────────────────────────────────────────
  if (Array.isArray(data)) {
    const itemSchema = jsonSchema.items as Record<string, unknown> | undefined;
    if (itemSchema) {
      for (let i = 0; i < data.length; i++) {
        data[i] = preCoerce(data[i], itemSchema);
      }
    }
    return data;
  }

  // ── Object coercion (recurse into properties) ────────────────────────────
  if (typeof data === 'object') {
    const properties = jsonSchema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (properties) {
      const obj = data as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (properties[key]) {
          obj[key] = preCoerce(obj[key], properties[key]);
        }
      }
    }
    return data;
  }

  return data;
}

// ─── Compiled validator type ──────────────────────────────────────────────────

type ValidateFunction = (data: unknown) => {
  valid: boolean;
  data?: unknown;
  errors?: Record<string, string>;
};

// ─── JSON Schema extraction ───────────────────────────────────────────────────

// A schema we can duck-type. Zod v4 ships `toJSONSchema()` as an instance
// method; Zod v3 does not. We isolate the unsafe cast in one place rather
// than `as unknown as <inline-type>` at every call site.
interface ZodV4Schema {
  toJSONSchema(): object;
}
function asZodV4(schema: ZodTypeAny): ZodV4Schema | null {
  const candidate = schema as unknown as { toJSONSchema?: unknown };
  return candidate && typeof candidate.toJSONSchema === 'function'
    ? (candidate as ZodV4Schema)
    : null;
}

/**
 * Version-safe helper that reads Zod's internal schema descriptor
 * without crashing when internal field names change between minor versions.
 *
 * Zod v4 uses `.def`; Zod v3 uses `._def`. This helper abstracts that so
 * `isStrictZodObject` and `isPassthroughZodObject` don't couple to a
 * specific naming convention — if Zod renames these again, only this
 * one function needs updating.
 */
function safeZodDef(schema: any): Record<string, any> {
  if (!schema || typeof schema !== 'object') return {};
  // Prefer .def (Zod v4), fall back to ._def (Zod v3)
  const d = schema.def ?? schema._def;
  if (!d || typeof d !== 'object') return {};
  return d;
}

function isStrictZodObject(schema: any): boolean {
  const d = safeZodDef(schema);
  // Zod v3: unknownKeys === 'strict'
  if (d.unknownKeys === 'strict') return true;
  // Zod v4: catchall type is 'never'
  if (d.catchall?.type === 'never' || d.catchall?.typeName === 'ZodNever')
    return true;
  return false;
}

function isPassthroughZodObject(schema: any): boolean {
  const d = safeZodDef(schema);
  // Zod v3: unknownKeys === 'passthrough'
  if (d.unknownKeys === 'passthrough') return true;
  // Zod v4: catchall type is 'unknown'
  if (d.catchall?.type === 'unknown' || d.catchall?.typeName === 'ZodUnknown')
    return true;
  return false;
}

function isZodObject(schema: any): boolean {
  const d = safeZodDef(schema);
  const typeName = schema?.constructor?.name || d.typeName || d.type;
  if (
    typeName === 'ZodObject' ||
    d.typeName === 'ZodObject' ||
    d.type === 'object'
  )
    return true;
  return false;
}

function unwrapZodSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const d = safeZodDef(schema);
  const typeName = schema.constructor?.name || d.typeName || d.type;

  if (
    typeName === 'ZodOptional' ||
    typeName === 'ZodNullable' ||
    typeName === 'ZodDefault'
  ) {
    return unwrapZodSchema(d.inner || d.innerType);
  }
  if (typeName === 'ZodEffects') {
    return unwrapZodSchema(d.schema);
  }
  return schema;
}

function adjustAdditionalProperties(jsonSchema: any, zodSchema: any): void {
  if (!jsonSchema || typeof jsonSchema !== 'object') return;
  if (!zodSchema || typeof zodSchema !== 'object') return;

  const unwrapped = unwrapZodSchema(zodSchema);
  const typeName =
    unwrapped?.constructor?.name ||
    unwrapped?._def?.typeName ||
    unwrapped?.def?.type;

  if (jsonSchema.anyOf && Array.isArray(jsonSchema.anyOf)) {
    const options =
      unwrapped?.options || unwrapped?.def?.options || unwrapped?._def?.options;
    for (let i = 0; i < jsonSchema.anyOf.length; i++) {
      const subZod = Array.isArray(options) ? options[i] : unwrapped;
      adjustAdditionalProperties(jsonSchema.anyOf[i], subZod);
    }
    return;
  }
  if (jsonSchema.oneOf && Array.isArray(jsonSchema.oneOf)) {
    const options =
      unwrapped?.options || unwrapped?.def?.options || unwrapped?._def?.options;
    for (let i = 0; i < jsonSchema.oneOf.length; i++) {
      const subZod = Array.isArray(options) ? options[i] : unwrapped;
      adjustAdditionalProperties(jsonSchema.oneOf[i], subZod);
    }
    return;
  }

  // 2. Handle object schemas
  if (isZodObject(unwrapped)) {
    const strict = isStrictZodObject(unwrapped);
    const passthrough = isPassthroughZodObject(unwrapped);

    if (jsonSchema.type === 'object') {
      if (!strict && !passthrough) {
        jsonSchema.additionalProperties = true;
      }

      if (jsonSchema.properties && unwrapped.shape) {
        const shape =
          typeof unwrapped.shape === 'function'
            ? unwrapped.shape()
            : unwrapped.shape;
        for (const key of Object.keys(jsonSchema.properties)) {
          if (shape[key]) {
            adjustAdditionalProperties(jsonSchema.properties[key], shape[key]);
          }
        }
      }
    }
  } else if (typeName === 'ZodArray' && jsonSchema.type === 'array') {
    const element =
      unwrapped.element || unwrapped.def?.element || unwrapped._def?.type;
    if (element && jsonSchema.items) {
      adjustAdditionalProperties(jsonSchema.items, element);
    }
  } else if (typeName === 'ZodIntersection') {
    const left = unwrapped.left || unwrapped.def?.left || unwrapped._def?.left;
    const right =
      unwrapped.right || unwrapped.def?.right || unwrapped._def?.right;
    if (jsonSchema.allOf && Array.isArray(jsonSchema.allOf)) {
      if (jsonSchema.allOf[0] && left)
        adjustAdditionalProperties(jsonSchema.allOf[0], left);
      if (jsonSchema.allOf[1] && right)
        adjustAdditionalProperties(jsonSchema.allOf[1], right);
    }
  }
}

/**
 * Extracts the JSON Schema from a Zod schema. Tries Zod v4's built-in
 * `toJSONSchema()` first, then falls back to `zod-to-json-schema`.
 * Returns `null` if neither is available.
 */
function extractJsonSchema(schema: ZodTypeAny): object | null {
  const v4 = asZodV4(schema);
  let jsonSchema: object | null = null;
  if (v4) {
    try {
      jsonSchema = v4.toJSONSchema();
    } catch {
      jsonSchema = null;
    }
  }
  if (!jsonSchema) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { zodToJsonSchema } = require('zod-to-json-schema');
      jsonSchema = zodToJsonSchema(schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      });
    } catch {
      jsonSchema = null;
    }
  }

  if (jsonSchema) {
    adjustAdditionalProperties(jsonSchema, schema);
  }
  return jsonSchema;
}

// ─── Validator source hint ────────────────────────────────────────────────────
// Tells `buildValidator` where the data originates so it can apply the right
// coercion strategy. Query and params always arrive as strings from the HTTP
// layer; body may contain mixed types from JSON parsing.

type ValidatorSource = 'body' | 'query' | 'params' | 'response';

// ─── Validator factory ────────────────────────────────────────────────────────

/**
 * Builds the fastest correct validator for a Zod schema.
 *
 * **Coercion strategy by source:**
 *
 *   `query` / `params` — HTTP always delivers strings. Pre-coerce string values
 *   to the type declared in the JSON Schema (string → number, string → boolean)
 *   before Zod parses. Uses Zod-only path (no AJV) since schemas are small and
 *   Zod handles coercion natively via `.coerce.*` or after pre-coercion.
 *
 *   `body` — JSON parsing usually preserves types, but HTML forms and some
 *   clients send strings. Pre-coerce before AJV's fast-rejection filter, then
 *   Zod parse for transforms/defaults.
 *
 *   `response` — No coercion. Response data comes from the handler, not HTTP.
 *
 * When `ajv` is installed (it usually is — it's a transitive dep of many tools):
 *
 *   Startup  : z.toJSONSchema(schema) → AJV.compile()     [happens once]
 *   Request  : preCoerce(data)  →  ajvValidate(data)      [0.06µs/call]
 *              If invalid → format AJV errors             [~428x faster than Zod on invalid]
 *              If valid → schema.parse() for transforms   [applies .default(), .transform(), .coerce.*]
 *
 * When `ajv` is NOT installed, falls back to Zod `safeParse` (correct, ~1.6x slower).
 */
function buildValidator(
  schema: ZodTypeAny,
  source: ValidatorSource = 'body',
): ValidateFunction {
  const jsonSchema = extractJsonSchema(schema);

  // ── Query / Params: Zod-only path with pre-coercion ──────────────────────
  // These always arrive as strings from HTTP. Pre-coerce first, then let
  // Zod handle the rest. AJV would reject string→number mismatches that
  // are perfectly valid after coercion, so we skip it entirely.
  if (source === 'query' || source === 'params') {
    return (data: unknown) => {
      const coerced = jsonSchema
        ? preCoerce(data, jsonSchema as Record<string, unknown>)
        : data;
      return createZodValidator(schema)(coerced);
    };
  }

  // ── Body: AJV fast-path with pre-coercion ────────────────────────────────
  const ajv = getAjv();

  if (ajv && jsonSchema) {
    try {
      const ajvValidate = ajv.compile(jsonSchema as object);

      return (data: unknown) => {
        // Pre-coerce string values to the type declared in the JSON Schema.
        // This handles the case where a client sends `"5"` for a number field
        // (common with HTML forms, query-string-encoded bodies, etc).
        const coerced = preCoerce(data, jsonSchema as Record<string, unknown>);

        const structurallyValid = ajvValidate(coerced);

        if (!structurallyValid) {
          // Fast rejection path — build error map from AJV's already-collected errors.
          // This is ~428x faster than Zod's error path for complex schemas.
          const errors: Record<string, string> = {};
          for (const err of ajvValidate.errors ?? []) {
            const path =
              err.instancePath.replace(/^\//, '').replace(/\//g, '.') ||
              '_root';
            const isRootMissing =
              err.instancePath === '' &&
              (err.keyword === 'type' || err.keyword === 'required');
            errors[path] = isRootMissing
              ? 'The request body is missing or empty'
              : (err.message ?? 'Invalid value');
          }
          return { valid: false, errors };
        }

        // Always run Zod's parse() to apply .default(), .transform(), .coerce.*,
        // and crucially, to safely strip unknown properties. AJV is only used
        // as a fast-rejection filter.
        try {
          const parsed = schema.parse(coerced);
          return { valid: true, data: parsed };
        } catch {
          // AJV said valid but Zod disagrees. Fall through to full Zod validator.
          return createZodValidator(schema)(coerced);
        }
      };
    } catch {
      // z.toJSONSchema() threw — schema uses features not expressible in JSON
      // Schema (rare: recursive schemas, ZodNever in non-obvious positions).
    }
  }

  // ── Fallback: Zod-only with pre-coercion for body ────────────────────────
  if (source === 'body' && jsonSchema) {
    return (data: unknown) => {
      const coerced = preCoerce(data, jsonSchema as Record<string, unknown>);
      return createZodValidator(schema)(coerced);
    };
  }

  return createZodValidator(schema);
}

/**
 * Pure Zod validator — used when AJV is unavailable or the schema cannot be
 * expressed in JSON Schema.
 */
function createZodValidator(schema: ZodTypeAny): ValidateFunction {
  return (data: unknown) => {
    const result = schema.safeParse(data);
    if (result.success) return { valid: true, data: result.data };

    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
      // Root-level type mismatch (null/undefined/non-object body when an
      // object was expected). Detection is code-based — NOT string-matched
      // — so it survives Zod locale changes, custom error maps, and minor
      // version upgrades that reword `issue.message`.
      const isRootMissing =
        issue.path.length === 0 &&
        issue.code === 'invalid_type' &&
        (data === null || data === undefined);
      errors[path] = isRootMissing
        ? 'The request body is missing or empty'
        : issue.message;
    }
    return { valid: false, errors };
  };
}

// ─── ValidationCompiler ───────────────────────────────────────────────────────

export class ValidationCompiler {
  private compiledSchemas = new Map<
    string,
    {
      body?: ValidateFunction;
      query?: ValidateFunction;
      params?: ValidateFunction;
      response?: ValidateFunction | Record<number, ValidateFunction>;
    }
  >();

  constructor(private readonly logger: AxiomifyLogger = defaultLogger) {}

  public compile(routeId: string, schema: RouteSchema): void {
    const compiled: {
      body?: ValidateFunction;
      query?: ValidateFunction;
      params?: ValidateFunction;
      response?: ValidateFunction | Record<number, ValidateFunction>;
    } = {};

    if (schema.body)
      compiled.body = buildValidator(schema.body as ZodTypeAny, 'body');
    if (schema.query)
      compiled.query = buildValidator(schema.query as ZodTypeAny, 'query');
    if (schema.params)
      compiled.params = buildValidator(schema.params as ZodTypeAny, 'params');

    if (schema.response) {
      if (isZodSchema(schema.response)) {
        compiled.response = buildValidator(schema.response, 'response');
      } else {
        const responseMap: Record<number, ValidateFunction> = {};
        for (const [code, zodSchema] of Object.entries(schema.response)) {
          responseMap[Number(code)] = buildValidator(
            zodSchema as ZodTypeAny,
            'response',
          );
        }
        compiled.response = responseMap;
      }
    }

    this.compiledSchemas.set(routeId, compiled);
  }

  public execute(routeId: string, req: AxiomifyRequest): void {
    const validators = this.compiledSchemas.get(routeId);
    if (!validators) return;

    const errors: Record<string, Record<string, string>> = {};
    let hasErrors = false;

    if (validators.body) {
      const result = validators.body(req.body);
      if (!result.valid) {
        errors.body = result.errors!;
        hasErrors = true;
      } else req.body = result.data;
    }

    if (validators.query) {
      const result = validators.query(req.query);
      if (!result.valid) {
        errors.query = result.errors!;
        hasErrors = true;
      } else req.query = result.data as Record<string, string | string[]>;
    }

    if (validators.params) {
      const result = validators.params(req.params);
      if (!result.valid) {
        errors.params = result.errors!;
        hasErrors = true;
      } else req.params = result.data as Record<string, string>;
    }

    if (hasErrors)
      throw new ValidationError('Request validation failed', errors);
  }

  public validateResponse(
    routeId: string,
    data: unknown,
    statusCode = 200,
  ): void {
    const validators = this.compiledSchemas.get(routeId);
    if (!validators?.response) return;

    let validator: ValidateFunction;
    if (typeof validators.response === 'function') {
      validator = validators.response;
    } else {
      // Exact-match only: never fall back to the 200 schema for a different
      // status code. A 201/204/etc. may have a legitimately different shape,
      // and silently applying the wrong schema produces false-positive errors.
      // If no schema is registered for this status code, skip validation.
      validator = validators.response[statusCode];
      if (!validator) return;
    }

    const result = validator(data);
    if (!result.valid) {
      const isProduction = process.env['NODE_ENV'] === 'production';
      if (isProduction) {
        // In production: log and continue — a response-schema mismatch is a
        // developer bug, not a user-facing error. Throwing a 500 here would
        // replace a valid (but mis-typed) payload with an error response,
        // making the bug harder to diagnose and worsening user impact.
        this.logger.error(
          `[Axiomify] Response validation failed for ${routeId} (status ${statusCode}). ` +
            `The handler returned data that does not match schema.response. ` +
            `Set NODE_ENV=development to surface this as a thrown error.`,
          { routeId, statusCode, errors: result.errors ?? {} },
        );
        return;
      }
      // In development / test: throw so the developer catches the mismatch
      // immediately rather than discovering it through a monitoring alert.
      throw new ValidationError(
        'Response validation failed',
        { response: result.errors ?? {} },
        500,
      );
    }
  }
}

export function createErrorSanitizer(options: { logger?: any } = {}) {
  const logger = options.logger || console;
  return (
    err: unknown,
  ): { statusCode: number; message: string; data?: any } | null => {
    if (!err || typeof err !== 'object') return null;
    const anyErr = err as any;
    const name = anyErr.name || anyErr.constructor?.name || '';

    if (
      name.includes('PrismaClientKnownRequestError') ||
      anyErr.code?.startsWith('P20')
    ) {
      if (anyErr.code === 'P2002') {
        return {
          statusCode: 409,
          message: 'Conflict: Unique constraint failed',
          data: anyErr.meta?.target
            ? { target: anyErr.meta.target }
            : undefined,
        };
      }
      if (anyErr.code === 'P2025') {
        return {
          statusCode: 404,
          message: anyErr.meta?.cause || 'Resource not found',
        };
      }
      return {
        statusCode: 400,
        message: 'Database error: ' + (anyErr.code || 'unknown'),
      };
    }

    if (
      name.includes('QueryFailedError') ||
      name.includes('SequelizeDatabaseError') ||
      name.includes('MongoError')
    ) {
      if (
        anyErr.code === '11000' ||
        anyErr.message?.includes('duplicate key')
      ) {
        return {
          statusCode: 409,
          message: 'Conflict: Unique constraint failed',
        };
      }
      return {
        statusCode: 400,
        message: 'Database operation failed',
      };
    }

    return null;
  };
}
