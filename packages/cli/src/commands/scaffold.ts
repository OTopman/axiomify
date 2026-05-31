/**
 * `axiomify scaffold route <method> <path>` — generate a new route file
 * under `src/routes/` with Zod schemas pre-stubbed.
 *
 * Optional flags:
 *   --auth        add `requireAuth` to the plugin chain
 *   --rate-limit  add a default rate-limit plugin to the chain
 *   --dry-run     print the would-be output to stdout without writing
 *
 * Idempotent — if the target file already exists, prints a hint and
 * exits 0 instead of overwriting. Use `--force` to overwrite.
 *
 * Currently the v5.1 starter shape. Future work (per docs/v5.1-roadmap):
 *   - Auto-register the route in src/index.ts
 *   - Support WS method (`axiomify scaffold route WS /chat`)
 *   - Conventional directory layout per RFC-style /v1/users/:id → users/[id].ts
 */
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import { symbols } from '../utils/format';

export interface ScaffoldRouteOptions {
  auth?: boolean;
  rateLimit?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /** Directory under cwd where route files are created. Defaults to `src/routes`. */
  dir?: string;
}

const VALID_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'WS',
]);

/**
 * Convert an Axiomify path to a sensible filename.
 *   /users/:id         → users-by-id.ts
 *   /api/v1/orders     → api-v1-orders.ts
 *   /chat              → chat.ts
 */
function pathToFilename(routePath: string): string {
  const cleaned = routePath
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? `by-${seg.slice(1)}` : seg))
    .join('-');
  return cleaned || 'root';
}

function generateRouteSource(
  method: string,
  routePath: string,
  opts: ScaffoldRouteOptions,
): string {
  const isWs = method === 'WS';
  const params = routePath.match(/:[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  const paramKeys = params.map((p) => p.slice(1));

  const plugins: string[] = [];
  const extraImports: string[] = [];
  if (opts.auth) {
    plugins.push('requireAuth');
    extraImports.push(
      `import { createAuthPlugin } from '@axiomify/auth';\n\n` +
        `const requireAuth = createAuthPlugin({\n` +
        `  secret: process.env.JWT_SECRET!,\n` +
        `});`,
    );
  }
  if (opts.rateLimit) {
    plugins.push('limiter');
    extraImports.push(
      `import { createRateLimitPlugin, MemoryStore } from '@axiomify/rate-limit';\n\n` +
        `// Replace MemoryStore with RedisStore for multi-process / multi-host.\n` +
        `const limiter = createRateLimitPlugin({\n` +
        `  windowMs: 60_000,\n` +
        `  max: 100,\n` +
        `  store: new MemoryStore(),\n` +
        `});`,
    );
  }

  if (isWs) {
    return [
      `import type { Axiomify } from '@axiomify/core';`,
      `import { z } from 'zod';`,
      extraImports.length ? extraImports.join('\n\n') + '\n' : '',
      `/**`,
      ` * Registers WebSocket route ${routePath}.`,
      ` * Wire this into your entry file:`,
      ` *   import { registerRoute } from './routes/${pathToFilename(routePath)}';`,
      ` *   registerRoute(app);`,
      ` */`,
      `export function registerRoute(app: Axiomify): void {`,
      `  app.ws({`,
      `    path: '${routePath}',`,
      paramKeys.length > 0
        ? `    schema: {\n` +
          `      params: z.object({ ${paramKeys.map((k) => `${k}: z.string()`).join(', ')} }),\n` +
          `      // Define your message shape here — runtime-validated on every incoming frame.\n` +
          `      message: z.object({\n        text: z.string(),\n      }),\n    },`
        : `    schema: {\n      // Define your message shape here — runtime-validated on every incoming frame.\n      message: z.object({\n        text: z.string(),\n      }),\n    },`,
      plugins.length > 0 ? `    plugins: [${plugins.join(', ')}],` : '',
      `    open: (client, _req) => {`,
      `      client.send({ type: 'welcome' });`,
      `    },`,
      `    message: (client, data) => {`,
      `      // \`data\` is typed and validated from the schema above.`,
      `      client.send({ echo: data.text });`,
      `    },`,
      `    close: (_client, code, reason) => {`,
      `      console.log('connection closed', code, reason);`,
      `    },`,
      `  });`,
      `}`,
      ``,
    ]
      .filter(Boolean)
      .join('\n');
  }

  // HTTP method
  return [
    `import type { Axiomify } from '@axiomify/core';`,
    `import { z } from 'zod';`,
    extraImports.length ? extraImports.join('\n\n') + '\n' : '',
    `/**`,
    ` * Registers ${method} ${routePath}.`,
    ` * Wire this into your entry file:`,
    ` *   import { registerRoute } from './routes/${pathToFilename(routePath)}';`,
    ` *   registerRoute(app);`,
    ` */`,
    `export function registerRoute(app: Axiomify): void {`,
    `  app.route({`,
    `    method: '${method}',`,
    `    path: '${routePath}',`,
    `    schema: {`,
    paramKeys.length > 0
      ? `      params: z.object({ ${paramKeys.map((k) => `${k}: z.string()`).join(', ')} }),`
      : '',
    method === 'POST' || method === 'PUT' || method === 'PATCH'
      ? `      body: z.object({\n        // TODO — define request body shape\n      }),`
      : '',
    `      // response: z.object({ /* response shape */ }),`,
    `    },`,
    `      // OpenAPI metadata (tags, summary, operationId etc.) lives in schema: too`,
    `      tags: ['${pathToFilename(routePath).split('-')[0] || 'general'}'],`,
    `      summary: '${method} ${routePath}',`,
    plugins.length > 0 ? `    plugins: [${plugins.join(', ')}],` : '',
    `    handler: async (${paramKeys.length > 0 || method !== 'GET' ? 'req' : '_req'}, res) => {`,
    method === 'POST'
      ? `      // TODO — handler logic\n      res.status(201).send({ ok: true });`
      : method === 'DELETE'
        ? `      // TODO — handler logic\n      res.status(204).send(null);`
        : `      // TODO — handler logic\n      res.send({ ok: true });`,
    `    },`,
    `  });`,
    `}`,
    ``,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function scaffoldRoute(
  method: string,
  routePath: string,
  opts: ScaffoldRouteOptions = {},
): Promise<void> {
  const upperMethod = method.toUpperCase();
  if (!VALID_METHODS.has(upperMethod)) {
    console.error(
      pc.red(`✗ Invalid method "${method}".`),
      `Expected one of: ${[...VALID_METHODS].join(', ')}.`,
    );
    process.exit(1);
  }
  if (!routePath.startsWith('/')) {
    console.error(pc.red('✗ Path must start with "/".'), `Got: ${routePath}`);
    process.exit(1);
  }

  const dir = opts.dir ?? 'src/routes';
  const filename = pathToFilename(routePath) + '.ts';
  const fileAbs = path.resolve(process.cwd(), dir, filename);

  const source = generateRouteSource(upperMethod, routePath, opts);

  if (opts.dryRun) {
    console.log(
      pc.dim(`# would write ${path.relative(process.cwd(), fileAbs)}\n`),
    );
    console.log(source);
    return;
  }

  let exists = false;
  try {
    await fs.access(fileAbs);
    exists = true;
  } catch {
    /* doesn't exist */
  }

  if (exists && !opts.force) {
    console.log(
      `${symbols.warn} ${pc.yellow('Already exists:')} ${path.relative(process.cwd(), fileAbs)}\n` +
        `   Pass ${pc.cyan('--force')} to overwrite, or pick a different path.`,
    );
    return;
  }

  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, source, 'utf8');

  console.log();
  console.log(
    `${symbols.ok} ${pc.green('Created')} ${pc.cyan(path.relative(process.cwd(), fileAbs))}`,
  );
  console.log();
  console.log(pc.dim('  Next steps:'));
  console.log(
    `    1. Wire it into your entry file:\n` +
      pc.dim(
        `         import { registerRoute } from './routes/${pathToFilename(routePath)}';\n`,
      ) +
      pc.dim(`         registerRoute(app);`),
  );
  console.log(
    `    2. Fill in the TODOs in ${pc.cyan(path.relative(process.cwd(), fileAbs))}.`,
  );
  console.log(
    `    3. Verify with ${pc.cyan('npx axiomify routes')} and ${pc.cyan('npx axiomify check')}.`,
  );
  console.log();
}
