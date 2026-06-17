# axiomify-app

## 6.2.3

### Patch Changes

- 105da33: - **@axiomify/cli**: Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by running the configured response serializer on mock responses.
  - **@axiomify/studio-ui**: Update Request Tester replay execution history to be displayed in descending chronological order (newest first).
- Updated dependencies [105da33]
  - @axiomify/graphql@6.3.2
  - @axiomify/openapi@6.3.2
  - @axiomify/helmet@6.3.2
  - @axiomify/logger@6.3.2
  - @axiomify/native@6.3.2
  - @axiomify/static@6.3.2
  - @axiomify/upload@6.3.2
  - @axiomify/auth@6.3.2
  - @axiomify/core@6.3.2

## 6.2.2

### Patch Changes

- 2637a16: Fix AJV validation failing with additional properties on default schemas by dynamically adjusting the `additionalProperties` mapping to match Zod's default/strict object semantics.
- Updated dependencies [2637a16]
  - @axiomify/graphql@6.3.1
  - @axiomify/openapi@6.3.1
  - @axiomify/helmet@6.3.1
  - @axiomify/logger@6.3.1
  - @axiomify/native@6.3.1
  - @axiomify/static@6.3.1
  - @axiomify/upload@6.3.1
  - @axiomify/auth@6.3.1
  - @axiomify/core@6.3.1
