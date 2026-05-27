/**
 * AsyncAPI 2.x/3.0 ingestion engine.
 *
 * Ingests AsyncAPI schemas into language-agnostic Event Contracts (IREventContract).
 */
import type {
  IRDiagnostic,
  IREventContract,
  IRParameter,
  IRSchema,
  IRSecurityScheme,
  IRServer,
  IRType,
  IRTypeRef
} from '../ir/types';

interface AsyncAPISpec {
  asyncapi: string;
  info: { title: string; version: string; description?: string };
  channels?: Record<string, AsyncAPIChannel>;
  components?: {
    schemas?: Record<string, any>;
    messages?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
  servers?: Record<string, AsyncAPIServer>;
}

interface AsyncAPIChannel {
  description?: string;
  address?: string; // AsyncAPI v3
  publish?: AsyncAPIOperation;
  subscribe?: AsyncAPIOperation;
  bindings?: Record<string, any>;
  parameters?: Record<string, any>;
}

interface AsyncAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  message?: any; // Message object or reference
}

interface AsyncAPIServer {
  url: string;
  protocol: string;
  protocolVersion?: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
}

const MAX_REF_DEPTH = 64;

export interface AsyncApiIngestOptions {
  title?: string;
  version?: string;
}

export function ingestAsyncApi(
  spec: Record<string, unknown>,
  options: AsyncApiIngestOptions = {}
): { schema: IRSchema; diagnostics: IRDiagnostic[] } {
  const as = spec as unknown as AsyncAPISpec;
  const diagnostics: IRDiagnostic[] = [];
  const types = new Map<string, IRType>();
  const securitySchemes = new Map<string, IRSecurityScheme>();
  const events: IREventContract[] = [];
  const refStack = new Set<string>();
  let anonCounter = 0;

  // ─── Reference Resolution ───
  function resolveRef(schema: any, depth = 0): any {
    if (depth > MAX_REF_DEPTH) {
      diagnostics.push({
        severity: 'error',
        code: 'REF_DEPTH_EXCEEDED',
        message: `$ref resolution exceeded max depth (${MAX_REF_DEPTH})`,
      });
      return { type: 'object' };
    }
    if (!schema || typeof schema !== 'object' || !schema.$ref) return schema;
    const ref = schema.$ref;
    if (refStack.has(ref)) return schema;
    refStack.add(ref);
    try {
      const resolved = resolveJsonPointer(as as unknown as Record<string, unknown>, ref);
      if (!resolved) {
        diagnostics.push({
          severity: 'warning',
          code: 'UNRESOLVED_REF',
          message: `Cannot resolve $ref: ${ref}`,
          location: ref,
        });
        return { type: 'object' };
      }
      // Merge other properties alongside resolved ref
      const { $ref, ...rest } = schema;
      return { ...resolveRef(resolved, depth + 1), ...rest };
    } finally {
      refStack.delete(ref);
    }
  }

  function resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
    const path = pointer
      .replace(/^#\//, '')
      .split('/')
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur: unknown = root;
    for (const seg of path) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
  }

  function refToTypeName(ref: string): string {
    return ref.split('/').pop()!;
  }

  function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ─── Type Parsing ───
  function schemaToTypeRef(schema: any, ctx?: string): IRTypeRef {
    if (!schema) return { inline: { id: '_any', kind: 'scalar', scalar: 'any' } };
    if (schema.$ref) {
      return { ref: refToTypeName(schema.$ref), nullable: schema.nullable };
    }
    const t = schemaToType(schema, ctx);
    if (t && types.has(t.id) && t.id !== ctx) return { ref: t.id, nullable: schema.nullable };
    return { inline: t ?? { id: '_unknown', kind: 'scalar', scalar: 'any' }, nullable: schema.nullable };
  }

  function schemaToType(raw: any, ctx?: string): IRType | undefined {
    const s = resolveRef(raw);
    if (!s) return undefined;

    if (s.allOf?.length) {
      const name = ctx ?? `Intersection${++anonCounter}`;
      return {
        id: name,
        kind: 'intersection',
        members: s.allOf.map((x: any, i: number) => schemaToTypeRef(x, `${name}_AllOf${i}`)),
        description: s.description,
        deprecated: s.deprecated,
      };
    }
    if (s.oneOf?.length) {
      const name = ctx ?? `Union${++anonCounter}`;
      return {
        id: name,
        kind: 'union',
        members: s.oneOf.map((x: any, i: number) => schemaToTypeRef(x, `${name}_OneOf${i}`)),
        description: s.description,
        deprecated: s.deprecated,
      };
    }
    if (s.enum?.length) {
      const name = ctx ?? `Enum${++anonCounter}`;
      const vt = typeof s.enum[0] === 'number' ? 'number' as const : 'string' as const;
      return {
        id: name,
        kind: 'enum',
        valueType: vt,
        values: s.enum.map((v: any) => ({ name: String(v), value: v as string | number })),
        description: s.description,
        deprecated: s.deprecated,
      };
    }

    const st = Array.isArray(s.type) ? s.type[0] : s.type;

    if (st === 'object' || s.properties) {
      const name = ctx ?? `Object${++anonCounter}`;
      const reqSet = new Set(s.required ?? []);
      const fields = Object.entries(s.properties ?? {}).map(([pn, ps]: [string, any]) => {
        const rs = resolveRef(ps);
        return {
          name: pn,
          type: schemaToTypeRef(rs, `${name}_${capitalize(pn)}`),
          required: reqSet.has(pn),
          description: rs.description,
          deprecated: rs.deprecated,
        };
      });
      return {
        id: name,
        kind: 'object',
        fields,
        description: s.description,
        deprecated: s.deprecated,
      };
    }

    if (st === 'array') {
      const name = ctx ?? `Array${++anonCounter}`;
      const items = s.items
        ? schemaToTypeRef(s.items, `${name}_Item`)
        : { inline: { id: '_any', kind: 'scalar' as const, scalar: 'any' as const } };
      return {
        id: name,
        kind: 'array',
        items,
        description: s.description,
      };
    }

    if (st) {
      const name = ctx ?? `Scalar${++anonCounter}`;
      return {
        id: name,
        kind: 'scalar',
        scalar: st === 'integer' ? 'integer' : st === 'number' ? 'number' : st === 'boolean' ? 'boolean' : 'string',
        format: s.format,
        description: s.description,
      };
    }

    return { id: ctx ?? `Unknown${++anonCounter}`, kind: 'scalar', scalar: 'any' };
  }

  // ─── Parse component schemas ───
  if (as.components?.schemas) {
    for (const [name, schema] of Object.entries(as.components.schemas)) {
      const t = schemaToType(schema, name);
      if (t) types.set(name, t);
    }
  }

  // ─── Ingest Channels → Event Contracts ───
  if (as.channels) {
    for (const [channelName, channel] of Object.entries(as.channels)) {
      // Determine protocol bindings (default to websocket / event)
      let transport: 'websocket' | 'socket.io' | 'sse' | 'event' = 'event';
      const wsBinding = channel.bindings?.ws || channel.bindings?.websocket;
      if (wsBinding) {
        transport = 'websocket';
      }

      // Check publish and subscribe operations
      const operations = [
        { op: channel.publish, dir: 'outbound' as const, suffix: 'Publish' },
        { op: channel.subscribe, dir: 'inbound' as const, suffix: 'Subscribe' },
      ];

      for (const { op, dir, suffix } of operations) {
        if (!op) continue;

        const resolvedOp = resolveRef(op);
        const resolvedMsg = resolveRef(resolvedOp.message);

        if (resolvedMsg) {
          const payloadSchema = resolvedMsg.payload ? resolveRef(resolvedMsg.payload) : undefined;
          const payloadRef = payloadSchema ? schemaToTypeRef(payloadSchema, `${capitalize(channelName.replace(/[^a-zA-Z0-9]/g, ''))}${suffix}Payload`) : undefined;

          // Parse channel parameters if any
          const headers: IRParameter[] = [];
          if (channel.parameters) {
            for (const [pName, pVal] of Object.entries(channel.parameters)) {
              const rp = resolveRef(pVal);
              headers.push({
                name: pName,
                location: 'header',
                type: schemaToTypeRef(rp?.schema || rp, `${pName}Param`),
                required: true,
                description: rp.description,
              });
            }
          }

          events.push({
            name: resolvedOp.operationId || resolvedMsg.name || `${channelName.replace(/[^a-zA-Z0-9]/g, '_')}_${dir}`,
            description: resolvedOp.description || resolvedMsg.description || channel.description,
            transport,
            channel: channelName,
            direction: dir,
            payload: payloadRef,
            tags: resolvedMsg.tags?.map((t: any) => t.name) || [],
            security: [],
          });
        }
      }
    }
  }

  // ─── Servers & Security ───
  const servers: IRServer[] = [];
  if (as.servers) {
    for (const [sName, sVal] of Object.entries(as.servers)) {
      servers.push({
        url: sVal.url,
        description: `${sName} - ${sVal.description || sVal.protocol}`,
      });
    }
  }

  return {
    schema: {
      info: {
        title: options.title ?? as.info.title,
        version: options.version ?? as.info.version,
        description: as.info.description,
        sourceFormat: 'event',
        sourceVersion: as.asyncapi,
      },
      types,
      endpoints: [],
      securitySchemes,
      servers,
      globalSecurity: [],
      events,
      reactiveContracts: [],
    },
    diagnostics,
  };
}
