# Contributing to Axiomify

[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Thanks for contributing. Follow the rules or expect rejection.

---

## 🧠 Development Philosophy

- Zero `any` — use generics or `unknown`
- Keep core engine framework-agnostic
- No Express/Fastify leakage into core
- Strong type inference is mandatory

---

## 🛠 Setup

```bash
git clone https://github.com/OTopman/axiomify.git
cd axiomify
npm install
```

## 🧪 Testing

```bash
npm run test
```

All features must include tests.

### Redis integration tests

`@axiomify/cache`, `@axiomify/session` and `@axiomify/ws` accept BYO Redis
clients (no Redis dependency ships in the repo). Their unit suites cover
this against in-memory fake clients for both the `ioredis` and `redis@4`
calling conventions; a small set of opt-in integration tests additionally
exercise the real protocol (TTL expiry, atomic `NX` locks, real
PUBLISH/SUBSCRIBE) against an actual Redis:

```bash
docker compose -f docker-compose.test.yml up -d redis
REDIS_URL=redis://localhost:6379 npx vitest run \
  packages/cache/tests/redis.integration.test.ts \
  packages/session/tests/redis.integration.test.ts \
  packages/ws/tests/redis.integration.test.ts
docker compose -f docker-compose.test.yml down
```

Without `REDIS_URL` set, these three files skip cleanly — they run as part
of the normal suite with zero setup. Each file scopes every key/channel it
touches under a run-unique prefix (pid + timestamp) and cleans up in
`afterAll`, so it's safe to point `REDIS_URL` at a shared instance.

The protocol client used by these tests
(`test-helpers/mini-redis.ts`) is test-only — it exists so the integration
suite doesn't require adding a Redis client as a real dependency.

## 🚫 Hard Rules

- Any usage of any will be rejected
- PRs without tests will not be reviewed
- Breaking changes without discussion will be closed
- Poor structure = rejection

## 📝 Commit Convention

Use Conventional Commits:

```text
feat: add plugin system
fix: resolve type inference issue
refactor: improve IR pipeline
```

Breaking change:

```
feat!: remove legacy API
```

## 🚀 PR Process

- Create feature branch
- Write tests
- Ensure lint + tests pass
- Open PR to main or develop
