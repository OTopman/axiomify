# Axiomify starter kits

Starter kits are small, deployable reference applications. Unlike the broad
`examples/` showcase, each starter has one production shape and documents the
operational choices it makes.

| Starter | Use it for | Includes |
| --- | --- | --- |
| [REST API](./rest-api) | A secure JSON service | versioned routes, Zod contracts, request IDs, security middleware, rate limiting, tests, Docker |

Copy a starter into a new repository, replace the sample domain logic, and pin
all `@axiomify/*` dependencies to the same released version. Contributions for
SaaS, real-time, and serverless starters should follow the recipe guidelines in
[`docs/recipes`](../docs/recipes/README.md).
