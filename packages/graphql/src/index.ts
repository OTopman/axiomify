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
  NoSchemaIntrospectionCustomRule,
  OperationDefinitionNode,
  parse,
  specifiedRules,
  validate,
} from 'graphql';

export type GraphQLContextFactory<TContext = Record<string, unknown>> = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
) => TContext | Promise<TContext>;

export interface GraphQLPluginOptions<TContext = Record<string, unknown>> {
  schema: GraphQLSchema;
  context?: GraphQLContextFactory<TContext>;
  path?: string;
  /**
   * Serve the GraphiQL playground. Disable in production.
   * @default true
   */
  playground?: boolean;
  playgroundPath?: string;
  maxDepth?: number;
  maxAliases?: number;
  validationRules?: ReadonlyArray<never>;
  /**
   * Disables GraphQL introspection queries (__schema, __type).
   *
   * Defaults to `true` in production (NODE_ENV === 'production') and `false`
   * otherwise. Introspection exposes your full schema to any client and is the
   * first reconnaissance step in targeted GraphQL attacks. Explicitly set this
   * option to override the environment-based default.
   */
  disableIntrospection?: boolean;
}

export interface GraphQLResult {
  data?: Record<string, unknown> | null;
  errors?: ReadonlyArray<{
    message: string;
    locations?: unknown;
    path?: unknown;
    extensions?: unknown;
  }>;
  extensions?: Record<string, unknown>;
}

function measureDepth(node: Record<string, unknown>, current = 0): number {
  if (node.selectionSet) {
    const children = (
      node.selectionSet as { selections: Record<string, unknown>[] }
    ).selections;
    return children.reduce(
      (max: number, s) => Math.max(max, measureDepth(s, current + 1)),
      current,
    );
  }
  return current;
}

function countAliases(node: Record<string, unknown>): number {
  let count = node.alias ? 1 : 0;
  if (node.selectionSet) {
    const children = (
      node.selectionSet as { selections: Record<string, unknown>[] }
    ).selections;
    count += children.reduce((sum: number, s) => sum + countAliases(s), 0);
  }
  return count;
}

function getQueryDepth(doc: DocumentNode): number {
  return doc.definitions.reduce(
    (max, def) =>
      Math.max(max, measureDepth(def as unknown as Record<string, unknown>)),
    0,
  );
}

function getQueryAliases(doc: DocumentNode): number {
  return doc.definitions.reduce(
    (sum, def) => sum + countAliases(def as unknown as Record<string, unknown>),
    0,
  );
}

function formatGraphQLErrors(errors: ReadonlyArray<GraphQLError>) {
  return errors.map((e) => ({
    message: e.message,
    locations: e.locations,
    path: e.path,
    extensions: e.extensions,
  }));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildPlaygroundHtml(graphqlPath: string): string {
  const htmlPath = escapeHtml(graphqlPath);
  const jsPath = escapeJsString(graphqlPath);

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
        background: #1a1a2e; color: #e0e0ff; padding: 10px 18px;
        display: flex; align-items: center; gap: 10px;
        font-size: 15px; font-weight: 600; letter-spacing: .02em;
        border-bottom: 1px solid #2e2e5e;
      }
      header span.badge { background: #6c63ff; color: #fff; border-radius: 4px; padding: 2px 7px; font-size: 11px; font-weight: 700; }
      #graphiql { flex: 1; }
    </style>
    <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
  </head>
  <body>
    <header>
      ⚡ Axiomify
      <span class="badge">GraphQL</span>
      <span style="opacity:.5;font-weight:400;font-size:13px">${htmlPath}</span>
    </header>
    <div id="graphiql"></div>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
    <script>
      const fetcher = GraphiQL.createFetcher({ url: '${jsPath}' });
      ReactDOM.createRoot(document.getElementById('graphiql')).render(
        React.createElement(GraphiQL, { fetcher })
      );
    </script>
  </body>
</html>`;
}

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

  // Default: disable introspection in production, enable in dev/test.
  // Explicit option always wins so callers can override in either direction.
  const disableIntrospection =
    options.disableIntrospection ?? process.env.NODE_ENV === 'production';

  const gqlPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const pgPath =
    rawPlaygroundPath ??
    (gqlPath.endsWith('/') ? `${gqlPath}playground` : `${gqlPath}/playground`);

  const allRules = [
    ...specifiedRules,
    ...(disableIntrospection ? [NoSchemaIntrospectionCustomRule] : []),
    ...validationRules,
  ];

  async function executeGraphQL(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    body: {
      query?: string;
      operationName?: string;
      variables?: Record<string, unknown>;
    },
    allowedOperations: ('query' | 'mutation' | 'subscription')[] = [
      'query',
      'mutation',
      'subscription',
    ],
  ): Promise<void> {
    const { query, operationName, variables } = body;

    if (!query || typeof query !== 'string') {
      return res
        .status(400)
        .sendRaw(
          JSON.stringify({ errors: [{ message: 'Missing "query" field.' }] }),
          'application/json',
        );
    }

    let document: DocumentNode;
    try {
      document = parse(query);
    } catch (parseErr: unknown) {
      return res.status(400).sendRaw(
        JSON.stringify({
          errors: [{ message: (parseErr as Error).message }],
        }),
        'application/json',
      );
    }

    // Reject disallowed operation types (e.g. mutations over GET).
    if (allowedOperations.length < 3) {
      for (const def of document.definitions) {
        const op = def as OperationDefinitionNode;
        if (op.operation && !allowedOperations.includes(op.operation)) {
          res.header('Allow', 'POST');
          return res.status(405).sendRaw(
            JSON.stringify({
              errors: [
                {
                  message: `Operation type "${op.operation}" is not allowed on this endpoint.`,
                },
              ],
            }),
            'application/json',
          );
        }
      }
    }

    if (maxDepth !== undefined) {
      const depth = getQueryDepth(document);
      if (depth > maxDepth) {
        return res.status(400).sendRaw(
          JSON.stringify({
            errors: [
              {
                message: `Query depth ${depth} exceeds maximum of ${maxDepth}.`,
              },
            ],
          }),
          'application/json',
        );
      }
    }

    if (maxAliases !== undefined) {
      const aliases = getQueryAliases(document);
      if (aliases > maxAliases) {
        return res.status(400).sendRaw(
          JSON.stringify({
            errors: [
              {
                message: `Query has ${aliases} aliases, exceeding maximum of ${maxAliases}.`,
              },
            ],
          }),
          'application/json',
        );
      }
    }

    const validationErrors = validate(schema, document, allRules);
    if (validationErrors.length > 0) {
      return res
        .status(400)
        .sendRaw(
          JSON.stringify({ errors: formatGraphQLErrors(validationErrors) }),
          'application/json',
        );
    }

    let ctx: TContext = {} as TContext;
    if (contextFactory) {
      try {
        ctx = await contextFactory(req, res);
      } catch (ctxErr: unknown) {
        return res.status(500).sendRaw(
          JSON.stringify({
            errors: [
              { message: (ctxErr as Error)?.message ?? 'Context error.' },
            ],
          }),
          'application/json',
        );
      }
    }

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

      return res
        .status(200)
        .sendRaw(JSON.stringify(result), 'application/json');
    } catch (execErr: unknown) {
      return res.status(500).sendRaw(
        JSON.stringify({
          errors: [
            { message: (execErr as Error)?.message ?? 'Execution error.' },
          ],
        }),
        'application/json',
      );
    }
  }

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
          return res.status(400).sendRaw(
            JSON.stringify({
              errors: [{ message: 'Could not parse "variables" as JSON.' }],
            }),
            'application/json',
          );
        }
      }

      await executeGraphQL(
        req,
        res,
        { query: q.query, operationName: q.operationName, variables },
        ['query'],
      );
    },
  });

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
