/**
 * GraphQL SDL ingestion engine.
 *
 * Parses a GraphQL schema (SDL string) and transforms it into the
 * language-agnostic IR. Handles object types, input types, enums,
 * unions, interfaces, queries, mutations, and subscriptions.
 *
 * Requires `graphql` as a peer dependency — the CLI dynamically imports
 * it so users without GraphQL schemas don't need it installed.
 */
import type {
  IRSchema,
  IRType,
  IRObjectType,
  IREnumType,
  IRUnionType,
  IRScalarType,
  IRField,
  IRTypeRef,
  IREndpoint,
  IRDiagnostic,
  IRScalar,
  IRGraphQLOperation,
} from '../ir/types';

export interface GraphQLIngestOptions {
  title?: string;
  version?: string;
}

/**
 * Ingest a GraphQL SDL string into the IR.
 * Dynamically imports the `graphql` package — throws a clear error
 * if it's not installed.
 */
export async function ingestGraphQL(
  sdl: string,
  options: GraphQLIngestOptions = {},
): Promise<{ schema: IRSchema; diagnostics: IRDiagnostic[] }> {
  let graphqlMod: typeof import('graphql');
  try {
    graphqlMod = await import('graphql');
  } catch {
    throw new Error(
      '`graphql` package is required for GraphQL schema ingestion. ' +
      'Install it: npm install graphql',
    );
  }

  const { buildSchema, isObjectType, isInputObjectType, isEnumType, isUnionType,
    isScalarType, isNonNullType, isListType, isInterfaceType } = graphqlMod;

  const diagnostics: IRDiagnostic[] = [];
  const types = new Map<string, IRType>();
  const endpoints: IREndpoint[] = [];

  let gqlSchema: import('graphql').GraphQLSchema;
  try {
    gqlSchema = buildSchema(sdl);
  } catch (err) {
    diagnostics.push({
      severity: 'error', code: 'GRAPHQL_PARSE_ERROR',
      message: `Failed to parse GraphQL SDL: ${(err as Error).message}`,
    });
    return {
      schema: {
        info: { title: options.title ?? 'GraphQL API', version: options.version ?? '1.0.0',
          sourceFormat: 'graphql' },
        types, endpoints, securitySchemes: new Map(), servers: [], globalSecurity: [],
      },
      diagnostics,
    };
  }

  const typeMap = gqlSchema.getTypeMap();

  // ─── Helper: GraphQL type → IRTypeRef ─────────────────────────────

  function gqlTypeToRef(gqlType: import('graphql').GraphQLType): IRTypeRef {
    if (isNonNullType(gqlType)) {
      const inner = gqlTypeToRef(gqlType.ofType);
      return { ...inner, nullable: false };
    }
    if (isListType(gqlType)) {
      const inner = gqlTypeToRef(gqlType.ofType);
      return { ...inner, isArray: true, nullable: true };
    }
    const named = gqlType as import('graphql').GraphQLNamedType;
    const name = named.name;

    // Built-in scalars → inline IR scalars
    const scalarMap: Record<string, IRScalar> = {
      String: 'string', Int: 'integer', Float: 'number',
      Boolean: 'boolean', ID: 'string',
    };
    if (scalarMap[name]) {
      return { inline: { id: name, kind: 'scalar', scalar: scalarMap[name] }, nullable: true };
    }

    return { ref: name, nullable: true };
  }

  // ─── Phase 1: Ingest types ─────────────────────────────────────────

  for (const [name, gqlType] of Object.entries(typeMap)) {
    // Skip introspection types (__Schema, __Type, etc) and built-in scalars.
    if (name.startsWith('__')) continue;
    if (['String', 'Int', 'Float', 'Boolean', 'ID'].includes(name)) continue;

    if (isObjectType(gqlType) || isInputObjectType(gqlType) || isInterfaceType(gqlType)) {
      const gqlFields = gqlType.getFields();
      const fields: IRField[] = Object.entries(gqlFields).map(([fieldName, field]) => {
        const typeRef = gqlTypeToRef(field.type);
        return {
          name: fieldName,
          type: typeRef,
          required: !typeRef.nullable,
          description: field.description ?? undefined,
          deprecated: !!(field as { deprecationReason?: string }).deprecationReason,
          deprecationReason: (field as { deprecationReason?: string }).deprecationReason ?? undefined,
        };
      });
      const irType: IRObjectType = {
        id: name, kind: 'object', fields,
        description: gqlType.description ?? undefined,
      };
      types.set(name, irType);
    } else if (isEnumType(gqlType)) {
      const irType: IREnumType = {
        id: name, kind: 'enum', valueType: 'string',
        values: gqlType.getValues().map((v) => ({
          name: v.name, value: v.value as string,
          description: v.description ?? undefined,
          deprecated: v.isDeprecated,
        })),
        description: gqlType.description ?? undefined,
      };
      types.set(name, irType);
    } else if (isUnionType(gqlType)) {
      const irType: IRUnionType = {
        id: name, kind: 'union',
        members: gqlType.getTypes().map((t) => ({ ref: t.name })),
        description: gqlType.description ?? undefined,
      };
      types.set(name, irType);
    } else if (isScalarType(gqlType)) {
      const irType: IRScalarType = {
        id: name, kind: 'scalar', scalar: 'string',
        description: gqlType.description ?? undefined,
      };
      types.set(name, irType);
    }
  }

  // ─── Phase 2: Ingest operations ────────────────────────────────────

  function extractOps(
    rootType: import('graphql').GraphQLObjectType | null | undefined,
    opType: IRGraphQLOperation,
  ) {
    if (!rootType) return;
    const gqlFields = rootType.getFields();
    for (const [fieldName, field] of Object.entries(gqlFields)) {
      const returnType = gqlTypeToRef(field.type);
      const queryParams = (field.args ?? []).map((arg) => {
        const typeRef = gqlTypeToRef(arg.type);
        return {
          name: arg.name,
          location: 'query' as const,
          type: typeRef,
          required: !typeRef.nullable,
          description: arg.description ?? undefined,
        };
      });

      endpoints.push({
        operationId: fieldName,
        summary: field.description ?? undefined,
        tags: [opType],
        transport: opType === 'subscription' ? 'websocket' : 'graphql',
        graphqlOperation: opType,
        graphqlField: fieldName,
        pathParams: [],
        queryParams,
        headerParams: [],
        responses: {
          '200': {
            statusCode: '200',
            description: 'Successful response',
            contentType: 'application/json',
            type: returnType,
          },
        },
        successResponse: '200',
        security: [],
      });
    }
  }

  extractOps(gqlSchema.getQueryType(), 'query');
  extractOps(gqlSchema.getMutationType(), 'mutation');
  extractOps(gqlSchema.getSubscriptionType(), 'subscription');

  return {
    schema: {
      info: {
        title: options.title ?? 'GraphQL API',
        version: options.version ?? '1.0.0',
        sourceFormat: 'graphql',
      },
      types, endpoints, securitySchemes: new Map(),
      servers: [], globalSecurity: [],
    },
    diagnostics,
  };
}
