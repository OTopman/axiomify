# Contributing to Axiomify

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