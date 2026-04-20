# @axiomify/auth

JWT authentication helpers for Axiomify route plugins.

## Install

```bash
npm install @axiomify/auth jsonwebtoken
```

## Exports

- `createAuthPlugin(options)`
- `createRefreshHandler(options)`
- `useAuth(options)` as an alias of `createAuthPlugin`

## Typical Usage

```ts
import { createAuthPlugin } from '@axiomify/auth';

const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
});

app.route({
  method: 'GET',
  path: '/me',
  plugins: [requireAuth],
  handler: async (req, res) => {
    res.send({ id: req.user?.id });
  },
});
```

## Options

`AuthOptions` supports:

- `secret`
- `algorithms`
- `getToken`

The plugin populates `req.user` after a successful verify.

## Refresh Flow

`createRefreshHandler(...)` creates a normal route handler, not a route plugin.

Use it for routes like `POST /auth/refresh`.
