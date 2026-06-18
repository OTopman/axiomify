# @axiomify/socket.io

## 6.3.3

### Patch Changes

- b9d0c2b: - **@axiomify/core**: Add public, type-safe `.resolve()` API to `Axiomify` class to retrieve registered DI services cleanly.
  - **@axiomify/cli**: Minor robustness fix in Studio API package resolution error handling.
  - **@axiomify/cli**: Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by running the configured response serializer on mock responses.
  - **@axiomify/studio-ui**: Update Request Tester replay execution history to be displayed in descending chronological order (newest first).
  - **@axiomify/jobs**: Introduce a resilient, type-safe distributed queue and Saga transaction workflow coordination engine with background workers and native Studio console integration.
  - **@axiomify/vault**: Introduce a secure environment and configuration vault with envelope encryption, ABAC module policies, standard stream redaction, and git-guard checks.
  - **@axiomify/logger**: Expand configuration options with granular opt-in controls (`includeParams`, `includeQuery`, `includeBody`, `includeResponseHeaders`, `includeState`) and safe `BigInt` log serialization.
  - **@axiomify/native**: Hardened privileged internal APIs (`lockRoutes`, `getRawServer`, `registerShutdownCallback`) via strict `ADAPTER_LOCK_TOKEN` validation, simplified payload size limit rejections, and added a pre-built cached 504 Gateway Timeout response wrapper.
- Updated dependencies [b9d0c2b]
  - @axiomify/native@6.3.3
  - @axiomify/core@6.3.3

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
