# Contributing to Axiomify

[![npm version](https://img.shields.io/npm/v/@axiomify/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)
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