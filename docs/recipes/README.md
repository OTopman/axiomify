# Axiomify recipes

Recipes are focused, production-oriented integration patterns maintained with
the community. They complement package references: use a recipe when you want
to solve a complete application concern, not merely learn an API.

## Available recipes

- [Scoped administration routes](./scoped-admin-routes.md) — apply auth and
  role checks to one route tree without affecting the rest of the application.
- [Request-to-job trace continuity](./request-to-job-trace.md) — preserve
  observability context when HTTP work becomes background work.

## Contributing a recipe

Copy [the recipe template](./_template.md), then open a pull request labelled
`community-recipe`. A recipe must:

- address a real, reusable problem;
- state its runtime and package prerequisites;
- be safe by default and call out production caveats;
- use public APIs only;
- include a small test or a runnable example when executable code is added.

Recipes are not a substitute for package documentation. Keep API-level detail
in the relevant package reference and link here from the community discussion
that motivated the pattern.
