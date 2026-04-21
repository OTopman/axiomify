import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import {
  DocumentNode,
  execute,
  GraphQLError,
  GraphQLSchema,
  parse,
  specifiedRules,
  validate,
} from 'graphql';

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * A factory that receives the raw Axiomify request and returns whatever
 * value you want available as `context` inside every resolver.
 */
export type GraphQLContextFactory<TContext = Record<string, unknown>> = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
) => TContext | Promise<TContext>;

export interface GraphQLPluginOptions<TContext = Record<string, unknown>> {
  /** The compiled GraphQL schema to execute against. */
  schema: GraphQLSchema;

  /**
   * Optional factory for building per-request context.
   * Defaults to an empty object `{}`.
   */
  context?: GraphQLContextFactory<TContext>;

  /**
   * The HTTP path at which the GraphQL endpoint is mounted.
   * @default '/graphql'
   */
  path?: string;

  /**
   * Set to `false` to disable the GraphiQL playground entirely.
   * @default true
   */
  playground?: boolean;

  /**
   * Path for the GraphiQL playground page.
   * @default '/graphql/playground'
   */
  playgroundPath?: string;

  /**
   * Maximum depth allowed for incoming GraphQL queries.
   * Helps prevent deeply nested query abuse.
   * @default undefined (no depth limit)
   */
  maxDepth?: number;

  /**
   * Maximum number of aliases allowed per query.
   * @default undefined (no alias limit)
   */
  maxAliases?: number;

  /**
   * Optional array of additional validation rules beyond the
   * GraphQL spec defaults.
   */
  validationRules?: ReadonlyArray<any>;
}

export interface GraphQLResult {
  data?: Record<string, unknown> | null;
  errors?: ReadonlyArray<{
    message: string;
    locations?: any;
    path?: any;
    extensions?: any;
  }>;
  extensions?: Record<string, unknown>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Recursively walks a parsed query to measure its depth.
 * Returns the maximum depth found.
 */
function measureDepth(node: any, current = 0): number {
  if (node.selectionSet) {
    const children = node.selectionSet.selections as any[];
    return Math.max(...children.map((s) => measureDepth(s, current + 1)));
  }
  return current;
}

function countAliases(node: any): number {
  let count = 0;
  if (node.alias) count += 1;
  if (node.selectionSet) {
    const children = node.selectionSet.selections as any[];
    count += children.reduce((sum, s) => sum + countAliases(s), 0);
  }
  return count;
}

function getQueryDepth(doc: DocumentNode): number {
  return Math.max(0, ...doc.definitions.map((def) => measureDepth(def)));
}

function getQueryAliases(doc: DocumentNode): number {
  return doc.definitions.reduce((sum, def) => sum + countAliases(def), 0);
}

function formatGraphQLErrors(errors: ReadonlyArray<GraphQLError>) {
  return errors.map((e) => ({
    message: e.message,
    locations: e.locations,
    path: e.path,
    extensions: e.extensions,
  }));
}

function buildPlaygroundHtml(graphqlPath: string): string {
  // Minimal self-contained GraphiQL playground (CDN-backed)
  const escapedPath = graphqlPath
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GraphiQL — Axiomify</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { height: 100vh; display: flex; flex-direction: column; font-family: system-ui, sans-serif; background: #0f0f0f; }
      header {
        background: #1a1a2e;
        color: #e0e0ff;
        padding: 10px 18px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: .02em;
        border-bottom: 1px solid #2e2e5e;
      }
      header span.badge {
        background: #6c63ff;
        color: #fff;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .05em;
      }
      #graphiql { flex: 1; }
    </style>
    <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
  </head>
  <body>
    <header>
      ⚡ Axiomify
      <span class="badge">GraphQL</span>
      <span style="opacity:.5;font-weight:400;font-size:13px">${escapedPath}</span>
    </header>
    <div id="graphiql"></div>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
    <script>
      const fetcher = GraphiQL.createFetcher({ url: '${escapedPath}' });
      ReactDOM.createRoot(document.getElementById('graphiql')).render(
        React.createElement(GraphiQL, { fetcher })
      );
    </script>
  </body>
</html>`;
}

// ─── Plugin entry point ───────────────────────────────────────────────────────

/**
 * Mounts a fully-featured GraphQL endpoint onto an Axiomify application.
 *
 * @example
 * ```ts
 * import { Axiomify } from '@axiomify/core';
 * import { useGraphQL } from '@axiomify/graphql';
 * import { schema } from './schema';
 *
 * const app = new Axiomify();
 *
 * useGraphQL(app, {
 *   schema,
 *   context: (req) => ({ userId: req.headers['x-user-id'] }),
 * });
 * ```
 */
export function useGraphQL<TContext = Record<string, unknown>>(
  app: Axiomify,
  options: GraphQLPluginOptions<TContext>,
): void {
  const {
    schema,
    context: contextFactory,
    path: rawPath = '/graphql',
    playground = true,
    playgroundPath: rawPlaygroundPath,
    maxDepth,
    maxAliases,
    validationRules = [],
  } = options;

  // Normalise the endpoint path
  const gqlPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const pgPath =
    rawPlaygroundPath ??
    (gqlPath.endsWith('/') ? `${gqlPath}playground` : `${gqlPath}/playground`);

  const allRules = [...specifiedRules, ...validationRules];

  // ── Shared execution logic ─────────────────────────────────────────────────
  async function executeGraphQL(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    body: {
      query?: string;
      operationName?: string;
      variables?: Record<string, unknown>;
    },
  ): Promise<void> {
    const { query, operationName, variables } = body;

    // 1. Require a query string
    if (!query || typeof query !== 'string') {
      const result: GraphQLResult = {
        errors: [{ message: 'Missing "query" field in request body.' }],
      };
      return res
        .status(400)
        .sendRaw(JSON.stringify(result), 'application/json');
    }

    // 2. Parse
    let document: DocumentNode;
    try {
      document = parse(query);
    } catch (parseErr: any) {
      const result: GraphQLResult = {
        errors: [{ message: parseErr.message }],
      };
      return res
        .status(400)
        .sendRaw(JSON.stringify(result), 'application/json');
    }

    // 3. Custom limits (depth / alias) — run BEFORE schema validation so
    //    abusive queries are rejected cheaply without touching the schema.
    if (maxDepth !== undefined) {
      const depth = getQueryDepth(document);
      if (depth > maxDepth) {
        const result: GraphQLResult = {
          errors: [
            {
              message: `Query depth ${depth} exceeds the maximum allowed depth of ${maxDepth}.`,
            },
          ],
        };
        return res
          .status(400)
          .sendRaw(JSON.stringify(result), 'application/json');
      }
    }

    if (maxAliases !== undefined) {
      const aliases = getQueryAliases(document);
      if (aliases > maxAliases) {
        const result: GraphQLResult = {
          errors: [
            {
              message: `Query contains ${aliases} aliases which exceeds the maximum of ${maxAliases}.`,
            },
          ],
        };
        return res
          .status(400)
          .sendRaw(JSON.stringify(result), 'application/json');
      }
    }

    // 4. Validate against schema
    const validationErrors = validate(schema, document, allRules);
    if (validationErrors.length > 0) {
      const result: GraphQLResult = {
        errors: formatGraphQLErrors(validationErrors),
      };
      return res
        .status(400)
        .sendRaw(JSON.stringify(result), 'application/json');
    }

    // 5. Build context
    let ctx: TContext = {} as TContext;
    if (contextFactory) {
      try {
        ctx = await contextFactory(req, res);
      } catch (ctxErr: any) {
        const result: GraphQLResult = {
          errors: [
            {
              message: ctxErr?.message ?? 'Context factory threw an error.',
            },
          ],
        };
        return res
          .status(500)
          .sendRaw(JSON.stringify(result), 'application/json');
      }
    }

    // 6. Execute
    try {
      const execResult = await execute({
        schema,
        document,
        contextValue: ctx,
        operationName: operationName ?? undefined,
        variableValues: variables ?? undefined,
      });

      const result: GraphQLResult = {
        data: execResult.data as Record<string, unknown> | null,
        ...(execResult.errors?.length
          ? { errors: formatGraphQLErrors(execResult.errors) }
          : {}),
        ...(execResult.extensions
          ? { extensions: execResult.extensions as Record<string, unknown> }
          : {}),
      };

      // GraphQL spec: always 200, even for partial errors
      return res
        .status(200)
        .sendRaw(JSON.stringify(result), 'application/json');
    } catch (execErr: any) {
      const result: GraphQLResult = {
        errors: [{ message: execErr?.message ?? 'Execution error.' }],
      };
      return res
        .status(500)
        .sendRaw(JSON.stringify(result), 'application/json');
    }
  }

  // ── POST /graphql — primary endpoint ──────────────────────────────────────
  app.route({
    method: 'POST',
    path: gqlPath,
    handler: async (req, res) => {
      const body = req.body as Record<string, unknown>;
      await executeGraphQL(req, res, {
        query: body?.query as string | undefined,
        operationName: body?.operationName as string | undefined,
        variables: body?.variables as Record<string, unknown> | undefined,
      });
    },
  });

  // ── GET /graphql — introspection / simple queries via query string ─────────
  //    e.g. GET /graphql?query={__typename}
  app.route({
    method: 'GET',
    path: gqlPath,
    handler: async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      let variables: Record<string, unknown> | undefined;

      if (q.variables) {
        try {
          variables = JSON.parse(q.variables);
        } catch {
          const result: GraphQLResult = {
            errors: [{ message: 'Could not parse "variables" as JSON.' }],
          };
          return res
            .status(400)
            .sendRaw(JSON.stringify(result), 'application/json');
        }
      }

      await executeGraphQL(req, res, {
        query: q.query,
        operationName: q.operationName,
        variables,
      });
    },
  });

  // ── GET /graphql/playground — GraphiQL UI ─────────────────────────────────
  if (playground) {
    app.route({
      method: 'GET',
      path: pgPath,
      handler: async (_req, res) => {
        res.status(200).sendRaw(buildPlaygroundHtml(gqlPath), 'text/html');
      },
    });
  }
}
