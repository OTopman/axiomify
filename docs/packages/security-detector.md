# @axiomify/security-detector

Detection primitives used by `@axiomify/security`.

## Install

```bash
npm install @axiomify/security-detector
```

## Exports

- `detectSqlInjection(input, patterns?)`
- `detectNoSqlInjection(input, patterns?)`
- `isSuspiciousUserAgent(userAgent, patterns?)`
- constants: `DEFAULT_SQL_PATTERNS`, `DEFAULT_NOSQL_PATTERNS`, `DEFAULT_BLOCKED_UA_PATTERNS`
