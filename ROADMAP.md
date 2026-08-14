# Axiomify roadmap

This is a living, community-facing priority list. It describes direction, not
a promise of delivery dates. Proposals remain open for discussion until their
API and compatibility story are clear.

## In progress

1. **Observability** — native trace-context and `Server-Timing` support,
   alongside existing OpenTelemetry, logging, metrics, and Studio work.
2. **Community foundations** — Discussions, clear contribution templates,
   contributor-friendly labels, and a visible path from idea to recipe.

## Next priorities

3. **Plugin encapsulation** — scoped plugin registration with inherited,
   non-leaking context.
4. **Recipes hub** — maintained, runnable solutions for real application
   concerns such as auth, queues, storage, webhooks, and multi-tenancy.
5. **Contract testing** — response-schema assertions, Studio contract checks,
   and route-surface compatibility gates are available; SDK contract coverage
   remains an ongoing integration target.
6. **API versioning** — route groups, OpenAPI deprecation metadata, runtime
   lifecycle headers, and CLI compatibility checks are available.
7. **Production starter kits** — a deployable REST API starter is available;
   SaaS, real-time, and serverless starters are open community contributions.

## How priorities move

A proposal moves forward when it has a clear user problem, a small compatible
API, an owner or contributors, tests, and documentation. Security fixes,
regressions, and ecosystem breakages take priority over this list.
