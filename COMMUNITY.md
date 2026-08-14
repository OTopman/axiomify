# Community guide

Axiomify aims to be a dependable, high-performance foundation for TypeScript
services. Community contributions are how it becomes useful for more real
applications, not just more benchmarks.

## Where to participate

- **GitHub Discussions** — questions, architecture advice, show-and-tell,
  integration ideas, and early proposals.
- **Issues** — reproducible bugs and scoped, actionable feature requests.
- **Pull requests** — implementations, documentation improvements, examples,
  and recipes. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first.
- **Security reports** — use the private reporting path in
  [SECURITY.md](./SECURITY.md), never a public issue.

## A welcoming contribution path

Start with an issue labelled `good first issue` or `help wanted`. Maintainers
should provide the expected package, API constraints, relevant tests, and a
definition of done before marking an issue `good first issue`.

Small contributions are valuable: clarify an error, add a failing regression
test, improve a recipe, verify a starter on a deployment provider, or report
benchmark methodology issues. Contributors should be credited in release
notes when their work ships.

## Discussions setup

Enable GitHub Discussions for the repository and create these categories:

| Category      | Use it for                                         |
| ------------- | -------------------------------------------------- |
| Announcements | releases, security notices, and roadmap updates    |
| Q&A           | usage and architecture questions                   |
| Ideas         | proposals before they become issues                |
| Show and tell | projects, plugins, and deployment write-ups        |
| Recipes       | reviewable integration patterns for the recipe hub |

Apply the labels in [.github/labels.yml](./.github/labels.yml) in repository
settings. Review the `needs-triage` queue weekly and rotate `good first issue`
work so new contributors get a timely response.

## Maintainer rhythm

- Publish concise release notes that name contributors and migration impact.
- Keep the public roadmap current; closed or deferred proposals need a reason.
- Prefer small, tested PRs. Design-heavy changes begin in Discussions or an
  issue before implementation.
- Treat performance claims as reproducible measurements, including hardware,
  Node version, and benchmark command.
