import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { diffSurfaces } from '../src/routes/diff';
import {
  buildRouteSurface,
  parseSurface,
  serialiseSurface,
} from '../src/routes/surface';

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const baseline = parseSurface(fixture('routes-baseline.json'), 'baseline');
const current = parseSurface(fixture('routes-current.json'), 'current');

describe('route surface builder', () => {
  const app = {
    registeredRoutes: [
      {
        method: 'POST',
        path: '/users',
        schema: {
          body: z.object({ name: z.string() }),
          tags: ['users'],
        },
      },
      {
        method: 'GET',
        path: '/users/:id',
        schema: {
          params: z.object({ id: z.string() }),
          response: z.object({ id: z.string() }),
          deprecated: true,
        },
      },
      { method: 'GET', path: '/health' },
    ],
    registeredWsRoutes: [{ path: '/chat', schema: {} }],
  };

  it('builds a v1 surface with schema hashes, deprecation, and tags', () => {
    const surface = buildRouteSurface(app);
    expect(surface.version).toBe(1);
    expect(surface.routes).toHaveLength(4);

    const post = surface.routes.find((r) => r.method === 'POST')!;
    expect(post.schemaHashes?.body).toMatch(/^[0-9a-f]{64}$/);
    expect(post.schemaHashes?.query).toBeUndefined();
    expect(post.tags).toEqual(['users']);

    const get = surface.routes.find((r) => r.path === '/users/:id')!;
    expect(get.deprecated).toBe(true);
    expect(get.schemaHashes?.params).toMatch(/^[0-9a-f]{64}$/);
    expect(get.schemaHashes?.response).toMatch(/^[0-9a-f]{64}$/);

    const health = surface.routes.find((r) => r.path === '/health')!;
    expect(health.schemaHashes).toBeUndefined();

    const ws = surface.routes.find((r) => r.path === '/chat')!;
    expect(ws.method).toBe('WS');
  });

  it('produces identical hashes for structurally identical schemas', () => {
    const a = buildRouteSurface({
      registeredRoutes: [
        {
          method: 'POST',
          path: '/x',
          schema: { body: z.object({ a: z.string(), b: z.number() }) },
        },
      ],
    });
    const b = buildRouteSurface({
      registeredRoutes: [
        {
          method: 'POST',
          path: '/x',
          schema: { body: z.object({ a: z.string(), b: z.number() }) },
        },
      ],
    });
    expect(a.routes[0].schemaHashes!.body).toBe(b.routes[0].schemaHashes!.body);
  });

  it('produces different hashes when the schema changes', () => {
    const before = buildRouteSurface({
      registeredRoutes: [
        {
          method: 'POST',
          path: '/x',
          schema: { body: z.object({ a: z.string() }) },
        },
      ],
    });
    const after = buildRouteSurface({
      registeredRoutes: [
        {
          method: 'POST',
          path: '/x',
          schema: { body: z.object({ a: z.number() }) },
        },
      ],
    });
    expect(before.routes[0].schemaHashes!.body).not.toBe(
      after.routes[0].schemaHashes!.body,
    );
  });

  it('serialises byte-identically across repeat runs and registration order', () => {
    const reversed = {
      registeredRoutes: [...app.registeredRoutes].reverse(),
      registeredWsRoutes: app.registeredWsRoutes,
    };
    const first = serialiseSurface(buildRouteSurface(app));
    const second = serialiseSurface(buildRouteSurface(app));
    const third = serialiseSurface(buildRouteSurface(reversed));
    expect(first).toBe(second);
    expect(first).toBe(third);
    expect(first.endsWith('\n')).toBe(true);
  });

  it('parses its own serialised output (round-trip)', () => {
    const surface = buildRouteSurface(app);
    const parsed = parseSurface(serialiseSurface(surface), 'roundtrip');
    expect(parsed).toEqual(surface);
  });

  it('accepts legacy bare-array baselines and rejects garbage', () => {
    const legacy = parseSurface(
      JSON.stringify([{ method: 'get', path: '/a' }]),
      'legacy',
    );
    expect(legacy.routes).toEqual([{ method: 'GET', path: '/a' }]);

    expect(() => parseSurface('{"nope": true}', 'bad')).toThrow(
      /not a route surface/,
    );
    expect(() => parseSurface('{invalid', 'bad')).toThrow(/Failed to parse/);
    expect(() =>
      parseSurface('{"version":1,"routes":[{"method":1}]}', 'bad'),
    ).toThrow(/invalid route entry/);
  });
});

describe('route surface diff (categorisation matrix)', () => {
  const result = diffSurfaces(baseline, current);

  const find = (kind: string, path?: string) =>
    result.changes.filter(
      (c) => c.kind === kind && (path === undefined || c.path === path),
    );

  it('reports added routes as info', () => {
    const [added] = find('added');
    expect(added).toMatchObject({
      kind: 'added',
      severity: 'info',
      method: 'POST',
      path: '/webhooks',
    });
  });

  it('reports removed routes as breaking', () => {
    const [removed] = find('removed');
    expect(removed).toMatchObject({
      kind: 'removed',
      severity: 'breaking',
      method: 'DELETE',
      path: '/users/:id',
    });
  });

  it('pairs a removed+added on the same path as a method change (breaking)', () => {
    const [changed] = find('method-changed');
    expect(changed).toMatchObject({
      severity: 'breaking',
      path: '/items/:id',
    });
    expect(changed.detail).toContain('PUT');
    expect(changed.detail).toContain('PATCH');
    // The paired added route must not surface independently.
    expect(find('added', '/items/:id')).toHaveLength(0);
    expect(find('removed', '/items/:id')).toHaveLength(0);
  });

  it('reports request-side schema changes (body/query/params) as breaking', () => {
    const [queryChange] = find('schema-changed', '/users');
    expect(queryChange).toMatchObject({
      severity: 'breaking',
      part: 'query',
      method: 'GET',
    });
  });

  it('reports response schema changes as warnings by default', () => {
    const [responseChange] = find('schema-changed', '/orders');
    expect(responseChange).toMatchObject({
      severity: 'warning',
      part: 'response',
    });
  });

  it('upgrades response changes to breaking with strictResponse', () => {
    const strict = diffSurfaces(baseline, current, { strictResponse: true });
    const change = strict.changes.find(
      (c) => c.path === '/orders' && c.part === 'response',
    )!;
    expect(change.severity).toBe('breaking');
    expect(strict.breaking).toBe(result.breaking + 1);
  });

  it('reports newly-deprecated routes as info', () => {
    const [dep] = find('newly-deprecated');
    expect(dep).toMatchObject({
      severity: 'info',
      method: 'GET',
      path: '/profile',
    });
  });

  it('tallies severities correctly', () => {
    // removed DELETE /users/:id + method-changed /items/:id + query change /users
    expect(result.breaking).toBe(3);
    // response change on /orders
    expect(result.warnings).toBe(1);
    // added /webhooks + newly-deprecated /profile
    expect(result.info).toBe(2);
    expect(result.changes).toHaveLength(6);
  });

  it('reports no changes for identical surfaces', () => {
    const clean = diffSurfaces(baseline, baseline);
    expect(clean.changes).toHaveLength(0);
    expect(clean.breaking).toBe(0);
  });

  it('skips schema comparison when the baseline has no hashes (legacy)', () => {
    const legacyBaseline = {
      version: 1 as const,
      routes: baseline.routes.map(({ schemaHashes: _drop, ...rest }) => rest),
    };
    const res = diffSurfaces(legacyBaseline, current);
    expect(res.changes.filter((c) => c.kind === 'schema-changed')).toHaveLength(
      0,
    );
  });

  it('treats a removed schema part as a change', () => {
    const withBody = {
      version: 1 as const,
      routes: [{ method: 'POST', path: '/x', schemaHashes: { body: 'abc' } }],
    };
    const withoutBody = {
      version: 1 as const,
      routes: [{ method: 'POST', path: '/x' }],
    };
    const res = diffSurfaces(withBody, withoutBody);
    expect(res.changes[0]).toMatchObject({
      kind: 'schema-changed',
      severity: 'breaking',
      part: 'body',
    });
    expect(res.changes[0].detail).toContain('removed');
  });
});
