import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import {
  DocumentNode,
  execute,
  FragmentDefinitionNode,
  GraphQLError,
  GraphQLSchema,
  NoSchemaIntrospectionCustomRule,
  OperationDefinitionNode,
  parse,
  SelectionSetNode,
  specifiedRules,
  validate,
  ValidationContext,
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
   * @default true outside production, false in production
   */
  playground?: boolean;
  playgroundPath?: string;
  maxDepth?: number;
  maxAliases?: number;
  /**
   * Maximum allowed field count in a query.
   * Prevents wide query attacks.
   * @default 100 in production, undefined in development
   */
  maxFields?: number;
  /**
   * Maximum allowed length (in characters) of the raw query string.
   * Rejects oversized queries with a 400 before parsing (CWE-400).
   * @default 10000
   */
  maxQueryLength?: number;
  /**
   * Maximum allowed length (in characters) of the serialized variables JSON.
   * Rejects oversized variables with a 400 before parsing (CWE-400).
   * @default 10000
   */
  maxVariablesLength?: number;
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

interface Metrics {
  depth: number;
  fields: number;
  aliases: number;
}

export function createAbusePreventionRule(options: {
  maxDepth?: number;
  maxAliases?: number;
  maxFields?: number;
}) {
  const { maxDepth, maxAliases, maxFields } = options;

  return (context: ValidationContext) => {
    const document = context.getDocument();

    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of document.definitions) {
      if (def.kind === 'FragmentDefinition') {
        fragments.set(def.name.value, def);
      }
    }

    const fragmentMetricsCache = new Map<string, Metrics>();
    const visitedFragments = new Set<string>();

    function getFragmentMetrics(fragName: string): Metrics {
      if (fragmentMetricsCache.has(fragName)) {
        return fragmentMetricsCache.get(fragName)!;
      }
      const fragDef = fragments.get(fragName);
      if (!fragDef) {
        return { depth: 0, fields: 0, aliases: 0 };
      }
      if (visitedFragments.has(fragName)) {
        return { depth: 0, fields: 0, aliases: 0 };
      }
      visitedFragments.add(fragName);
      const metrics = analyzeSelectionSet(fragDef.selectionSet);
      visitedFragments.delete(fragName);
      fragmentMetricsCache.set(fragName, metrics);
      return metrics;
    }

    function analyzeSelectionSet(selectionSet: SelectionSetNode): Metrics {
      let maxD = 0;
      let totalF = 0;
      let totalA = 0;

      for (const selection of selectionSet.selections) {
        if (selection.kind === 'Field') {
          let fieldDepth = 1;
          let fieldFields = 1;
          let fieldAliases = selection.alias ? 1 : 0;

          if (selection.selectionSet) {
            const sub = analyzeSelectionSet(selection.selectionSet);
            fieldDepth += sub.depth;
            fieldFields += sub.fields;
            fieldAliases += sub.aliases;
          }

          maxD = Math.max(maxD, fieldDepth);
          totalF += fieldFields;
          totalA += fieldAliases;
        } else if (selection.kind === 'FragmentSpread') {
          const fragName = selection.name.value;
          const sub = getFragmentMetrics(fragName);
          maxD = Math.max(maxD, sub.depth);
          totalF += sub.fields;
          totalA += sub.aliases;
        } else if (selection.kind === 'InlineFragment') {
          const sub = analyzeSelectionSet(selection.selectionSet);
          maxD = Math.max(maxD, sub.depth);
          totalF += sub.fields;
          totalA += sub.aliases;
        }
      }

      return { depth: maxD, fields: totalF, aliases: totalA };
    }

    return {
      OperationDefinition(node: OperationDefinitionNode) {
        const metrics = analyzeSelectionSet(node.selectionSet);

        if (maxDepth !== undefined && metrics.depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query depth ${metrics.depth} exceeds maximum of ${maxDepth}.`,
              node,
            ),
          );
        }

        if (maxAliases !== undefined && metrics.aliases > maxAliases) {
          context.reportError(
            new GraphQLError(
              `Query has ${metrics.aliases} aliases, exceeding maximum of ${maxAliases}.`,
              node,
            ),
          );
        }

        if (maxFields !== undefined && metrics.fields > maxFields) {
          context.reportError(
            new GraphQLError(
              `Query has ${metrics.fields} fields, exceeding maximum of ${maxFields}.`,
              node,
            ),
          );
        }
      },
    };
  };
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
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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
    <!--
      No SRI integrity attribute: pinning a hash requires fetching the asset
      at build time and is bypassed if any pinned URL ever 404s. The CSP
      below restricts script-src to unpkg.com / cdnjs.cloudflare.com, which
      is the actual control surface. If you need stricter guarantees,
      vendor the assets locally and host them yourself.
    -->
    <script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" integrity="sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" integrity="sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"></script>
    <script crossorigin src="https://unpkg.com/graphiql@3.8.3/graphiql.min.js" integrity="sha384-HbRVEFG0JGJZeAHCJ9Xm2+tpknBQ7QZmNlO/DgZtkZ0aJSypT96YYGRNod99l9Ie"></script>
    <script>
      const fetcher = GraphiQL.createFetcher({ url: ${jsPath} });
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
  const isProduction = process.env.NODE_ENV === 'production';
  const {
    schema,
    context: contextFactory,
    path: rawPath = '/graphql',
    playground = !isProduction,
    playgroundPath: rawPlaygroundPath,
    maxDepth = isProduction ? 12 : undefined,
    maxAliases = isProduction ? 15 : undefined,
    maxFields = isProduction ? 100 : undefined,
    maxQueryLength = 10000,
    maxVariablesLength = 10000,
    validationRules = [],
  } = options;

  // Default: disable introspection in production, enable in dev/test.
  // Explicit option always wins so callers can override in either direction.
  const disableIntrospection = options.disableIntrospection ?? isProduction;

  const gqlPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const pgPath =
    rawPlaygroundPath ??
    (gqlPath.endsWith('/') ? `${gqlPath}playground` : `${gqlPath}/playground`);

  const allRules = [
    ...specifiedRules,
    ...(disableIntrospection ? [NoSchemaIntrospectionCustomRule] : []),
    ...validationRules,
  ];

  if (
    maxDepth !== undefined ||
    maxAliases !== undefined ||
    maxFields !== undefined
  ) {
    allRules.push(
      createAbusePreventionRule({ maxDepth, maxAliases, maxFields }),
    );
  }

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

    // L4 (CWE-400): reject oversized inputs before parse()/validate() so a
    // huge query or variables payload cannot exhaust CPU/memory in the parser.
    if (query.length > maxQueryLength) {
      return res.status(400).sendRaw(
        JSON.stringify({
          errors: [
            {
              message: `Query exceeds maximum length of ${maxQueryLength} characters.`,
            },
          ],
        }),
        'application/json',
      );
    }

    if (variables !== undefined && variables !== null) {
      const variablesLength = JSON.stringify(variables).length;
      if (variablesLength > maxVariablesLength) {
        return res.status(400).sendRaw(
          JSON.stringify({
            errors: [
              {
                message: `Variables exceed maximum length of ${maxVariablesLength} characters.`,
              },
            ],
          }),
          'application/json',
        );
      }
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

    // Abuse prevention limits are evaluated dynamically via validation rules in the validate pass.

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
              {
                message:
                  process.env.NODE_ENV === 'production'
                    ? 'Context error.'
                    : ((ctxErr as Error)?.message ?? 'Context error.'),
              },
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
            {
              message:
                process.env.NODE_ENV === 'production'
                  ? 'Execution error.'
                  : ((execErr as Error)?.message ?? 'Execution error.'),
            },
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
        res.header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data:; fetch-src 'self';",
        );
        res.status(200).sendRaw(buildPlaygroundHtml(gqlPath), 'text/html');
      },
    });
  }
}
