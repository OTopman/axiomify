# @axiomify/studio-ui

## 6.3.1

### Patch Changes

- 2637a16: Fix AJV validation failing with additional properties on default schemas by dynamically adjusting the `additionalProperties` mapping to match Zod's default/strict object semantics.
