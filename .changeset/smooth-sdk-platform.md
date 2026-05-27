---
"@axiomify/cli": minor
"@axiomify/sdk-runtime": minor
---

**Enterprise Type-Safe SDK Generation Platform**

This release introduces the highly anticipated SDK Generation Platform, allowing you to generate multi-language client SDKs directly from your Axiomify backend, OpenAPI specs, or GraphQL schemas.

- **`axiomify sdk generate`**: Generate fully-typed SDKs for TypeScript, Python, Go, Swift, Kotlin, and Dart using our novel `TypeGraph` AST compiler.
- **`axiomify sdk diff`**: CI/CD tooling to compare API schemas and prevent breaking changes from reaching production.
- **`axiomify sdk validate`**: Strict syntactic and semantic validations for your schemas.
- **Live Watch Mode**: Run `axiomify dev --watch-sdk <langs...>` to automatically regenerate SDKs on the fly when your backend code changes.
- **`@axiomify/sdk-runtime`**: A new zero-dependency networking package that powers generated TypeScript SDKs with built-in retry engines, interceptors, and OAuth2 authentication injection.
