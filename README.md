# Axiomify 🚀

> A zero-boilerplate, code-first API contract system and universal engine.

[![npm version](https://img.shields.io/npm/v/axiomify.svg)](https://npmjs.org/package/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](https://www.typescriptlang.org/)

---

## ❌ The Problem

- Duplicate types between frontend and backend
- API contracts drift over time
- Runtime validation mismatches
- Manual OpenAPI maintenance

---

## ✅ The Solution

Axiomify lets you define your API once and generates everything else:
- Runtime validation
- Type-safe handlers
- OpenAPI documentation
- Typed frontend SDKs

---

## ✨ Features

- Universal Contract Engine (Express + Fastify)
- End-to-end type safety (Zero `any`)
- Zod-powered validation
- Auto-generated SDKs
- OpenAPI v3.1 generation
- Plugin lifecycle hooks (coming soon)
- Fast dev watcher

---

## 📦 Installation

```bash
npm install axiomify zod
```


## 🚀 Quick Start
### 1. Configuration

```typescript
import { defineConfig } from 'axiomify';

export default defineConfig({
  server: 'fastify',
  port: 3000,
  routesDir: 'src/routes'
});
```

### 2. Define a Route
```typescript

import { route, z } from 'axiomify';

export default route({
  method: 'POST',
  path: '/users',
  request: {
    body: z.object({
      email: z.string().email(),
      name: z.string()
    }),
  },
  response: z.object({
    id: z.string(),
    success: z.boolean()
  }),
  handler: async (ctx) => {
    return {
      id: 'usr_123',
      success: true
    };
  },
});
```

### 3. Start Dev Server
```bash
npx axiomify dev
````

## 🔄 Engine Agnostic
Switch runtime without changing business logic:
```typescript
export default defineConfig({
  server: 'express'
});
```

```typescript
export default defineConfig({
  server: 'fastify'
});
```

## 💻 CLI Commands
```bash
npx axiomify dev
npx axiomify build
npx axiomify generate
npx axiomify routes
```

## 🏗 Architecture

Axiomify is built around:
- Contract Definition Layer (Zod)
- Intermediate Representation (IR)
- Runtime Adapter (Express/Fastify)
- Code Generators (OpenAPI, SDKs)
  
```
Zod → IR → Runtime + Generators
```

## 🔢 Versioning
Axiomify follows Semantic Versioning:
- ```feat:``` → Minor release
- ```fix:``` → Patch release
- ```feat!:``` / ```BREAKING CHANGE:``` → Major release
  
## 📄 License
MIT © OTopman

---