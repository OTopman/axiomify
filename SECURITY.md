# Security Policy

## Supported Versions
| Version | Supported          |
| ------- | ------------------ |
| 3.x.x   | :white_check_mark: |
| < 3.0.0 | :x:                |

## Known-Safe Configuration Checklist
When deploying Axiomify to production, ensure the following constraints are met:
1. **Algorithm Pinning**: Explicitly pass `algorithms: ['HS256']` (or your chosen algorithm) to `useAuth`.
2. **Metrics Protection**: The `/metrics` endpoint exposes internal timing data. You **must** provide a `protect` hook returning `true` only for internal subnets or authenticated operators.
3. **Trust Proxy**: If deploying behind Nginx, AWS ALB, or Cloudflare, override the `useRateLimit` key generator to extract `x-forwarded-for`, otherwise all users share the same rate limit.
4. **Body Size Limits**: Configure `bodyLimitBytes` on your chosen HTTP adapter to prevent memory exhaustion.
5. **JWT Entropy**: Use a cryptographically secure random string of at least 32 characters (256 bits) for your JWT secret.

## Reporting a Vulnerability
Do not open public GitHub issues for security vulnerabilities. Please email security reports directly to the maintainers.
