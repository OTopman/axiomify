/**
 * Route surface extraction for `axiomify routes --json / --snapshot / --diff`.
 *
 * A "surface" is the machine-readable contract of an app's route table:
 * method + path plus a sha256 fingerprint of each validation schema part
 * (body/query/params/response). Hashes are computed over canonically-sorted
 * JSON Schema output — the same Zod → JSON Schema conversion the OpenAPI
 * generator uses — so two runs over the same source are byte-identical and
 * a hash change means the schema genuinely changed, not that key order did.
 */
import { createHash } from 'node:crypto';

export interface SchemaHashes {
  body?: string;
  query?: string;
  params?: string;
  response?: string;
}

export interface RouteSurfaceEntry {
  method: string;
  path: string;
  schemaHashes?: SchemaHashes;
  deprecated?: boolean;
  tags?: string[];
}

export interface RouteSurface {
  version: 1;
  routes: RouteSurfaceEntry[];
}

// ─── Zod → JSON Schema ───────────────────────────────────────────────────────
// Mirrors @axiomify/openapi's conversion strategy: Zod v4 ships a native
// `.toJSONSchema()`; Zod v3 installations fall back to zod-to-json-schema.

function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  const s = schema as {
    toJSONSchema?: (opts?: Record<string, unknown>) => Record<string, unknown>;
  };
  if (typeof s?.toJSONSchema === 'function') {
    const { $schema: _dropped, ...rest } = s.toJSONSchema({
      target: 'openApi3_1',
    });
    return rest;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { zodToJsonSchema: convert } = require('zod-to-json-schema');
    return convert(schema, { target: 'openApi3' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

// ─── Canonical JSON + hashing ────────────────────────────────────────────────

/** Recursively sort object keys so serialisation is order-independent. */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = canonicalise((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function hashJsonSchema(schema: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalise(schema)))
    .digest('hex');
}

function hashSchemaPart(part: unknown): string {
  if (isZodSchema(part)) return hashJsonSchema(zodToJsonSchema(part));
  // `schema.response` may be a map of status code → Zod schema. Hash the
  // canonical object of code → converted schema so adding/changing any
  // status variant changes the fingerprint.
  if (part !== null && typeof part === 'object') {
    const converted: Record<string, unknown> = {};
    for (const [code, sub] of Object.entries(part as Record<string, unknown>)) {
      converted[code] = isZodSchema(sub) ? zodToJsonSchema(sub) : sub;
    }
    return hashJsonSchema(converted);
  }
  return hashJsonSchema(part);
}

// ─── Surface builder ─────────────────────────────────────────────────────────

const METHOD_ORDER: Record<string, number> = {
  GET: 0,
  POST: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
  HEAD: 5,
  OPTIONS: 6,
  WS: 7,
};

function surfaceEntry(raw: any, isWs: boolean): RouteSurfaceEntry {
  const s = raw.schema ?? {};

  const hashes: SchemaHashes = {};
  // Fixed key order (body, query, params, response) keeps snapshots stable.
  if (s.body) hashes.body = hashSchemaPart(s.body);
  if (s.query) hashes.query = hashSchemaPart(s.query);
  if (s.params) hashes.params = hashSchemaPart(s.params);
  if (s.response) hashes.response = hashSchemaPart(s.response);

  const entry: RouteSurfaceEntry = {
    method: isWs ? 'WS' : String(raw.method ?? '').toUpperCase(),
    path: raw.path,
  };
  if (Object.keys(hashes).length > 0) entry.schemaHashes = hashes;
  if (s.deprecated === true) entry.deprecated = true;
  if (Array.isArray(s.tags) && s.tags.length > 0)
    entry.tags = [...s.tags].map(String);
  return entry;
}

/**
 * Build the route surface for a loaded Axiomify app (HTTP + WS routes).
 * Entries are sorted by path, then method — deterministic regardless of
 * registration order.
 */
export function buildRouteSurface(app: {
  registeredRoutes?: readonly any[];
  registeredWsRoutes?: readonly any[];
}): RouteSurface {
  const entries = [
    ...(app.registeredRoutes ?? []).map((r) => surfaceEntry(r, false)),
    ...(app.registeredWsRoutes ?? []).map((r) => surfaceEntry(r, true)),
  ];
  entries.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const am = METHOD_ORDER[a.method] ?? 99;
    const bm = METHOD_ORDER[b.method] ?? 99;
    if (am !== bm) return am - bm;
    return a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
  });
  return { version: 1, routes: entries };
}

/**
 * Serialise a surface for `--json` / `--snapshot`. Byte-identical across
 * repeat runs: entries are pre-sorted, keys are written in a fixed order,
 * output is 2-space-indented JSON with a trailing newline.
 */
export function serialiseSurface(surface: RouteSurface): string {
  const ordered = {
    version: surface.version,
    routes: surface.routes.map((r) => {
      const out: Record<string, unknown> = { method: r.method, path: r.path };
      if (r.schemaHashes) {
        const h: Record<string, string> = {};
        if (r.schemaHashes.body) h.body = r.schemaHashes.body;
        if (r.schemaHashes.query) h.query = r.schemaHashes.query;
        if (r.schemaHashes.params) h.params = r.schemaHashes.params;
        if (r.schemaHashes.response) h.response = r.schemaHashes.response;
        out.schemaHashes = h;
      }
      if (r.deprecated) out.deprecated = true;
      if (r.tags) out.tags = r.tags;
      return out;
    }),
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

/**
 * Parse a baseline file's contents into a RouteSurface. Accepts the
 * `{ version: 1, routes: [...] }` shape and, for compatibility with older
 * `axiomify routes --json` output, a bare array of route objects (which
 * carries no schema hashes — schema comparisons are skipped for those).
 */
export function parseSurface(raw: string, source: string): RouteSurface {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse ${source}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const routes: unknown = Array.isArray(parsed)
    ? parsed
    : parsed !== null &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as Record<string, unknown>).routes)
      ? (parsed as Record<string, unknown>).routes
      : undefined;

  if (!Array.isArray(routes)) {
    throw new Error(
      `${source} is not a route surface. Expected { "version": 1, "routes": [...] } ` +
        '(generate one with `axiomify routes --snapshot`).',
    );
  }

  const entries: RouteSurfaceEntry[] = [];
  for (const r of routes) {
    if (
      r === null ||
      typeof r !== 'object' ||
      typeof (r as any).method !== 'string' ||
      typeof (r as any).path !== 'string'
    ) {
      throw new Error(
        `${source} contains an invalid route entry — every entry needs string ` +
          '"method" and "path" fields.',
      );
    }
    const e = r as Record<string, unknown>;
    const entry: RouteSurfaceEntry = {
      method: (e.method as string).toUpperCase(),
      path: e.path as string,
    };
    if (e.schemaHashes && typeof e.schemaHashes === 'object') {
      entry.schemaHashes = e.schemaHashes as SchemaHashes;
    }
    if (e.deprecated === true) entry.deprecated = true;
    if (Array.isArray(e.tags)) entry.tags = e.tags.map(String);
    entries.push(entry);
  }
  return { version: 1, routes: entries };
}
