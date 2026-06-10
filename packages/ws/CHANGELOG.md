# @axiomify/ws

## 6.3.2

### Patch Changes

- 105da33: - **@axiomify/cli**: Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by running the configured response serializer on mock responses.
  - **@axiomify/studio-ui**: Update Request Tester replay execution history to be displayed in descending chronological order (newest first).
- Updated dependencies [105da33]
  - @axiomify/native@6.3.2
  - @axiomify/core@6.3.2

## 6.3.1

### Patch Changes

- 2637a16: Fix AJV validation failing with additional properties on default schemas by dynamically adjusting the `additionalProperties` mapping to match Zod's default/strict object semantics.
- Updated dependencies [2637a16]
  - @axiomify/native@6.3.1
  - @axiomify/core@6.3.1
